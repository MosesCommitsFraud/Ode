import { useEffect, useReducer, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { EQ_BANDS, EQ_RANGE_DB, eqResponse, spectrumFrequencies, SPECTRUM_FLOOR, type EqSettings } from "~/lib/filters";
import { engine, isTauri } from "~/lib/engine";
import { cn } from "~/lib/utils";

/*
 * Diagramme der Geräte-Seiten mit uPlot: EQ-Kurve über dem echten Spektrum,
 * Spektrum mit Frequenzmarke und Pegelverläufe mit ziehbarer Linie. Die
 * Daten sind exakt: Spektrum per FFT aus der Engine, Frequenzgänge aus
 * denselben Filterformeln wie dort (lib/filters.ts). Farben kommen live aus
 * dem Thema der App, Hell und Dunkel wechseln ohne Neuaufbau.
 */

/* ---------- Farben ---------- */

const swatch = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
const rgbCache = new Map<string, [number, number, number]>();

/** Beliebige CSS-Farbe (auch oklch) als rgba mit Deckkraft, für die Zeichenfläche. */
function rgba(color: string, alpha = 1) {
  let rgb = rgbCache.get(color);
  if (!rgb && swatch) {
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = color;
    swatch.fillRect(0, 0, 1, 1);
    const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
    rgb = [r, g, b];
    rgbCache.set(color, rgb);
  }
  const [r, g, b] = rgb ?? [128, 128, 128];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Farbe einer CSS-Variable am Element (z. B. die Gerätefarbe --ch-mic). */
export function token(el: Element | null, name: string, alpha = 1) {
  const value = el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  return rgba(value || "#888", alpha);
}

export const FONT = '10px "JetBrains Mono Variable", ui-monospace, monospace';

/* ---------- uPlot in React ---------- */

/**
 * Hält ein uPlot an der Größe seines Platzes. `build` erzeugt die Optionen
 * einmal; neue Daten gehen per `setData` hinein, ohne neu aufzubauen.
 */
export function Plot({
  build,
  data,
  className,
  onReady,
}: {
  build: (el: HTMLDivElement) => Omit<Options, "width" | "height">;
  data: AlignedData;
  className?: string;
  onReady?: (u: uPlot) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = new uPlot({ ...build(el), width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }, latest.current, el);
    plot.current = u;
    onReady?.(u);
    const observer = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }));
    observer.observe(el);
    // Thema gewechselt: Farben neu lesen.
    const theme = new MutationObserver(() => u.redraw(false));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      observer.disconnect();
      theme.disconnect();
      u.destroy();
      plot.current = null;
    };
    // Optionen werden nur beim Einhängen gebaut; Änderungen laufen über die Daten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Mit Neuberechnung der Skalen; die Bereiche sind fest, und nur so zeichnet uPlot neu.
    plot.current?.setData(data);
  }, [data]);

  return <div ref={ref} className={cn("ode-plot absolute inset-0", className)} />;
}

/** Ziehen im Zeichenbereich: liefert Werte auf den angegebenen Skalen. */
export function draggable(u: uPlot, onDrag: (x: number, y: number, start: boolean) => void, scales: { x: string; y: string }) {
  const over = u.over;
  const at = (e: PointerEvent, start: boolean) => {
    const r = over.getBoundingClientRect();
    onDrag(u.posToVal(e.clientX - r.left, scales.x), u.posToVal(e.clientY - r.top, scales.y), start);
  };
  over.style.touchAction = "none";
  over.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    over.setPointerCapture(e.pointerId);
    at(e, true);
  });
  over.addEventListener("pointermove", (e) => over.hasPointerCapture(e.pointerId) && at(e, false));
}

/** Beschriftete Marke auf der Zeichenfläche (z. B. „Bass +3 dB“), weicht am Rand aus. */
export function tag(u: uPlot, x: number, y: number, text: string, color: string, bg: string) {
  const ctx = u.ctx;
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.font = FONT.replace("10px", `${10 * pr}px`);
  const w = ctx.measureText(text).width + 10 * pr;
  const h = 16 * pr;
  const right = x + 12 * pr + w < u.bbox.left + u.bbox.width;
  const tx = right ? x + 10 * pr : x - 10 * pr - w;
  const ty = Math.max(u.bbox.top, Math.min(y - h - 6 * pr, u.bbox.top + u.bbox.height - h));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(tx, ty, w, h, 4 * pr);
  ctx.fill();
  ctx.fillStyle = color;
  // uPlot lässt nach den Achsen eine andere Ausrichtung stehen.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, tx + 5 * pr, ty + h / 2);
  ctx.restore();
}

export function dot(u: uPlot, x: number, y: number, fill: string, ring: string) {
  const ctx = u.ctx;
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 6 * pr, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4 * pr;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2 * pr;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
}

/* ---------- Achsen ---------- */

const FREQ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

export function axisStyle(el: HTMLElement) {
  return {
    stroke: () => token(el, "--muted-foreground"),
    grid: { stroke: () => token(el, "--muted-foreground", 0.14), width: 1 },
    ticks: { show: false },
    font: FONT,
    gap: 4,
  };
}

function freqAxis(el: HTMLElement, scale = "x"): uPlot.Axis {
  // uPlot zeigt auf log. Achsen sonst nur Zehnerpotenzen; `filter` lässt alle eigenen Striche stehen.
  return { ...axisStyle(el), scale, size: 22, splits: () => FREQ_TICKS, filter: (_u, splits) => splits, values: (_u, splits) => splits.map(freqLabel) };
}

/* ---------- EQ ---------- */

export const EQ_FREQS = spectrumFrequencies;
const BAND_KEYS = EQ_BANDS.map((b) => b.key);

/**
 * Frequenzgang eines EQs: in der App exakt aus der Engine (dieselben
 * fundsp-Filter wie im Audio-Thread), in der Browser-Vorschau nachgerechnet.
 */
export function useEqCurve(eq: EqSettings) {
  const [curve, setCurve] = useState(() => eqResponse(eq, EQ_FREQS));
  const key = `${eq.lowDb}|${eq.midDb}|${eq.highDb}|${eq.lowCutHz}|${eq.highCutHz}`;
  useEffect(() => {
    if (!isTauri) {
      setCurve(eqResponse(eq, EQ_FREQS));
      return;
    }
    let current = true;
    void engine.eqCurve(eq).then((c) => current && setCurve(c));
    return () => {
      current = false;
    };
    // Nur bei geänderten Werten neu holen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return curve;
}

/**
 * EQ-Kurve in der Gerätefarbe über dem gemessenen Spektrum: grau vor dem EQ,
 * farbig getönt danach. Die drei Bänder sind Punkte auf der Kurve; Ziehen
 * nach oben hebt an, nach unten senkt ab.
 */
export function EqChart({
  eq,
  labels,
  onChange,
  spectrumIn,
  spectrumOut,
}: {
  eq: EqSettings;
  /** Namen der Bänder für die Marken, z. B. „Bass“. */
  labels: [string, string, string];
  onChange: (key: "lowDb" | "midDb" | "highDb", db: number) => void;
  spectrumIn?: number[];
  spectrumOut?: number[];
}) {
  const state = useRef({ eq, labels, onChange, active: 0 });
  state.current = { ...state.current, eq, labels, onChange };
  const curve = useEqCurve(eq);
  const empty = EQ_FREQS.map(() => SPECTRUM_FLOOR);
  const data: AlignedData = [EQ_FREQS, spectrumIn?.length ? spectrumIn : empty, spectrumOut?.length ? spectrumOut : empty, curve];

  return (
    <Plot
      data={data}
      build={(el) => ({
        padding: [10, 12, 0, 0],
        legend: { show: false },
        cursor: { show: false, drag: { x: false, y: false } },
        scales: {
          x: { time: false, distr: 3, log: 10, range: [20, 20000] },
          db: { range: [-EQ_RANGE_DB, EQ_RANGE_DB] },
          spec: { range: [-90, 0] },
        },
        axes: [
          freqAxis(el),
          { ...axisStyle(el), scale: "db", size: 34, splits: () => [-12, -6, 0, 6, 12], values: (_u, s) => s.map((v) => (v > 0 ? `+${v}` : String(v))) },
        ],
        series: [
          {},
          { scale: "spec", stroke: () => token(el, "--muted-foreground", 0.35), fill: () => token(el, "--muted-foreground", 0.12), width: 1, points: { show: false } },
          { scale: "spec", stroke: () => token(el, "--ch-mic", 0.45), fill: () => token(el, "--ch-mic", 0.14), width: 1, points: { show: false } },
          { scale: "db", stroke: () => token(el, "--ch-mic"), width: 2.5, points: { show: false } },
        ],
        hooks: {
          draw: [
            (u) => {
              const { eq: current, labels: names } = state.current;
              EQ_BANDS.forEach((b, i) => {
                const x = u.valToPos(b.freq, "x", true);
                const y = u.valToPos(current[b.key], "db", true);
                dot(u, x, y, token(el, "--ch-mic"), "white");
                const v = current[b.key];
                tag(u, x, y, `${names[i]} ${v > 0 ? "+" : ""}${v.toFixed(1)} dB`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
              });
            },
          ],
          ready: [
            (u) =>
              draggable(
                u,
                (f, db, start) => {
                  const s = state.current;
                  // Beim Drücken das nächste Band wählen (auf der log. Achse), dann nur noch die Höhe.
                  if (start) {
                    const distance = (freq: number) => Math.abs(Math.log(freq / f));
                    s.active = EQ_BANDS.reduce((best, b, i) => (distance(b.freq) < distance(EQ_BANDS[best].freq) ? i : best), 0);
                  }
                  const value = Math.round(Math.min(12, Math.max(-12, db)) * 2) / 2;
                  s.onChange(BAND_KEYS[s.active], value);
                },
                { x: "x", y: "db" },
              ),
          ],
        },
      })}
    />
  );
}

/**
 * Gemessenes Spektrum mit einer senkrechten Marke ab `markerHz` (z. B. wo
 * der De-Esser oder Exciter greift); die Marke lässt sich waagrecht ziehen.
 */
export function SpectrumChart({
  spectrum,
  markerHz,
  markerLabel,
  range,
  onMarker,
}: {
  spectrum?: number[];
  markerHz: number;
  markerLabel: string;
  /** Erlaubter Bereich der Marke in Hz. */
  range: [number, number];
  onMarker: (hz: number) => void;
}) {
  const state = useRef({ markerHz, markerLabel, onMarker, range });
  state.current = { markerHz, markerLabel, onMarker, range };
  const data: AlignedData = [EQ_FREQS, spectrum?.length ? spectrum : EQ_FREQS.map(() => SPECTRUM_FLOOR)];
  return (
    <Plot
      data={data}
      build={(el) => ({
        padding: [10, 12, 0, 0],
        legend: { show: false },
        cursor: { show: false, drag: { x: false, y: false } },
        scales: { x: { time: false, distr: 3, log: 10, range: [20, 20000] }, spec: { range: [-90, 0] } },
        axes: [freqAxis(el), { ...axisStyle(el), scale: "spec", size: 34, splits: () => [-80, -60, -40, -20, 0], values: (_u, s) => s.map(String) }],
        series: [{}, { scale: "spec", stroke: () => token(el, "--muted-foreground", 0.5), fill: () => token(el, "--muted-foreground", 0.14), width: 1, points: { show: false } }],
        hooks: {
          draw: [
            (u) => {
              const s = state.current;
              const x = u.valToPos(s.markerHz, "x", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.fillStyle = token(el, "--ch-mic", 0.14);
              ctx.fillRect(x, u.bbox.top, u.bbox.left + u.bbox.width - x, u.bbox.height);
              ctx.strokeStyle = token(el, "--ch-mic");
              ctx.lineWidth = 2 * uPlot.pxRatio;
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.restore();
              const y = u.bbox.top + 14 * uPlot.pxRatio;
              dot(u, x, y, token(el, "--ch-mic"), "white");
              tag(u, x, y + 24 * uPlot.pxRatio, s.markerLabel, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
            },
          ],
          ready: [
            (u) =>
              draggable(
                u,
                (hz) => {
                  const [lo, hi] = state.current.range;
                  state.current.onMarker(Math.round(Math.min(hi, Math.max(lo, hz)) / 100) * 100);
                },
                { x: "x", y: "spec" },
              ),
          ],
        },
      })}
    />
  );
}

/* ---------- Verläufe ---------- */

export type HistorySeries = { values: number[]; tone: "muted" | "accent" | "warning"; scale?: "level" | "gr" };

/**
 * Verlauf über die letzten Sekunden: Pegel als Fläche, optional die
 * Absenkung von oben (eigene Skala) und eine waagrechte Linie (Schwelle,
 * Ziel, Obergrenze), die sich senkrecht ziehen lässt.
 */
export function HistoryChart({
  series,
  range,
  line,
  grMax = 18,
}: {
  series: HistorySeries[];
  /** Pegelbereich in dB, unten bis oben. */
  range: [number, number];
  line?: { value: number; label: string; min: number; max: number; onChange: (v: number) => void };
  grMax?: number;
}) {
  const state = useRef({ line });
  state.current = { line };
  const length = series[0]?.values.length ?? 0;
  const x = Array.from({ length }, (_, i) => i);
  const data: AlignedData = [x, ...series.map((s) => s.values)];
  const step = range[1] - range[0] > 40 ? 20 : 10;
  const splits: number[] = [];
  for (let v = Math.ceil(range[0] / step) * step; v <= range[1]; v += step) splits.push(v);
  const color = (el: HTMLElement, tone: HistorySeries["tone"], alpha = 1) =>
    tone === "accent" ? token(el, "--ch-mic", alpha) : tone === "warning" ? token(el, "--warning", alpha) : token(el, "--muted-foreground", alpha);

  return (
    <Plot
      data={data}
      build={(el) => ({
        padding: [10, 12, 6, 0],
        legend: { show: false },
        cursor: { show: false, drag: { x: false, y: false } },
        scales: { x: { time: false, range: [0, Math.max(1, length - 1)] }, level: { range }, gr: { range: [-grMax, 0] } },
        axes: [
          { show: false },
          { ...axisStyle(el), scale: "level", size: 34, splits: () => splits, values: (_u, s) => s.map(String) },
        ],
        series: [
          {},
          ...series.map((s) => ({
            scale: s.scale ?? "level",
            stroke: () => color(el, s.tone, s.tone === "muted" ? 0.5 : 0.9),
            fill: () => color(el, s.tone, s.tone === "muted" ? 0.16 : 0.22),
            width: 1.5,
            points: { show: false },
            // Absenkung wächst von oben nach unten: Fläche zur Null hin.
            fillTo: s.scale === "gr" ? 0 : range[0],
          })),
        ],
        hooks: {
          draw: [
            (u) => {
              const l = state.current.line;
              if (!l) return;
              const y = u.valToPos(l.value, "level", true);
              const ctx = u.ctx;
              const pr = uPlot.pxRatio;
              ctx.save();
              ctx.strokeStyle = token(el, "--ch-mic");
              ctx.lineWidth = 2 * pr;
              ctx.setLineDash([5 * pr, 4 * pr]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y);
              ctx.lineTo(u.bbox.left + u.bbox.width, y);
              ctx.stroke();
              ctx.restore();
              const hx = u.bbox.left + u.bbox.width - 14 * pr;
              dot(u, hx, y, token(el, "--ch-mic"), "white");
              tag(u, u.bbox.left + 4 * pr, y + 22 * pr, l.label, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
            },
          ],
          ready: [
            (u) =>
              draggable(
                u,
                (_x, v) => {
                  const l = state.current.line;
                  if (l) l.onChange(Math.round(Math.min(l.max, Math.max(l.min, v))));
                },
                { x: "x", y: "level" },
              ),
          ],
        },
      })}
    />
  );
}

/**
 * Sammelt einen Wert in festem Takt (30 Hz) für die letzten `seconds`
 * Sekunden; pro Takt zählt der jüngste Wert.
 */
export function useHistory(value: number, seconds = 8, floor = -90) {
  const length = seconds * 30;
  const buffer = useRef<number[]>(Array(length).fill(floor));
  const latest = useRef(value);
  latest.current = value;
  const [, force] = useReducerTick();
  useEffect(() => {
    const id = window.setInterval(() => {
      buffer.current = [...buffer.current.slice(1), latest.current];
      force();
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [force]);
  return buffer.current;
}

function useReducerTick() {
  return useReducer((n: number) => n + 1, 0);
}
