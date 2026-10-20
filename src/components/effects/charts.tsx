import { useEffect, useReducer, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { bandShape, EQ_GAIN_LIMIT, EQ_RANGE_DB, eqResponse, HIGH_CUT_OFF, LOW_CUT_OFF, spectrumFrequencies, SPECTRUM_FLOOR } from "~/lib/filters";
import type { EqBand, EqSettings } from "~/lib/engine";
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
/** Angezeigter Pegelbereich der Spektren in dB. */
const SPECTRUM_RANGE: [number, number] = [-90, 0];

/** Was im EQ gewählt ist: ein Band (Index) oder einer der Cuts. */
export type EqTarget = number | "lowCut" | "highCut";

/** Frequenz auf zwei bis drei gültige Stellen, wie man sie liest: 87 Hz, 1,25 kHz. */
export function roundHz(f: number) {
  const clamped = Math.min(20_000, Math.max(20, f));
  const digits = Math.pow(10, Math.floor(Math.log10(clamped)) - (clamped < 1000 ? 1 : 2));
  return Number((Math.round(clamped / digits) * digits).toFixed(3));
}

export const formatHz = (f: number) => (f >= 1000 ? `${Number((f / 1000).toFixed(f >= 10_000 ? 1 : 2))} kHz` : `${Math.round(f)} Hz`);

/** Größte Güte eines Bands (eq.rs `clamped`): Glocken bis 10, Kuhschwänze bis 2. */
export const maxQ = (index: number, count: number) => (bandShape(index, count) === "peak" ? 10 : 2);

/** Neue Bänder mit einer Änderung an Band `index`. */
export function withBand(eq: EqSettings, index: number, patch: Partial<EqBand>) {
  return eq.bands.map((b, i) => (i === index ? { ...b, ...patch } : b));
}

/**
 * Frequenzgang eines EQs: in der App exakt aus der Engine (dieselben
 * fundsp-Filter wie im Audio-Thread), in der Browser-Vorschau nachgerechnet.
 */
export function useEqCurve(eq: EqSettings) {
  const [curve, setCurve] = useState(() => eqResponse(eq, EQ_FREQS));
  const key = JSON.stringify([eq.bands, eq.lowCutHz, eq.highCutHz]);
  useEffect(() => {
    if (!isTauri) {
      setCurve(eqResponse(eq, EQ_FREQS));
      return;
    }
    let current = true;
    const { bands, lowCutHz, highCutHz } = eq;
    void engine.eqCurve({ bands, lowCutHz, highCutHz }).then((c) => current && setCurve(c));
    return () => {
      current = false;
    };
    // Nur bei geänderten Werten neu holen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return curve;
}

/**
 * Parametrischer EQ als Kurve in der Gerätefarbe über dem gemessenen
 * Spektrum (grau vor dem EQ, farbig danach). Jedes Band ist ein Punkt:
 * waagrecht ziehen ändert die Frequenz, senkrecht die Verstärkung, das
 * Mausrad die Breite; Low- und High-Cut sitzen auf der Nulllinie und
 * lassen sich seitlich schieben. Doppelklick setzt einen Punkt zurück.
 */
export function EqChart({
  eq,
  name,
  offText,
  selected,
  onSelect,
  onChange,
  spectrumIn,
  spectrumOut,
}: {
  eq: EqSettings;
  /** Name eines Punkts für die Marke, z. B. „Mitten“. */
  name: (target: EqTarget) => string;
  /** Anzeige eines ausgeschalteten Cuts. */
  offText: string;
  selected: EqTarget;
  onSelect: (target: EqTarget) => void;
  onChange: (patch: Partial<EqSettings>) => void;
  spectrumIn?: number[];
  spectrumOut?: number[];
}) {
  const state = useRef({ eq, name, offText, selected, onSelect, onChange, drag: null as { target: EqTarget; dx: number; dy: number } | null });
  state.current = { ...state.current, eq, name, offText, selected, onSelect, onChange };
  const curve = useEqCurve(eq);
  const empty = EQ_FREQS.map(() => SPECTRUM_FLOOR);
  const data: AlignedData = [EQ_FREQS, spectrumIn?.length ? spectrumIn : empty, spectrumOut?.length ? spectrumOut : empty, curve];

  /** Punkte mit Lage in CSS-Pixeln des Zeichenbereichs. */
  const handles = (u: uPlot, current: EqSettings) => {
    const list: { target: EqTarget; x: number; y: number; off: boolean }[] = [
      { target: "lowCut", x: u.valToPos(current.lowCutHz, "x"), y: u.valToPos(0, "db"), off: current.lowCutHz <= LOW_CUT_OFF },
      ...current.bands.map((b, i) => ({ target: i as EqTarget, x: u.valToPos(b.freqHz, "x"), y: u.valToPos(b.gainDb, "db"), off: false })),
      { target: "highCut", x: u.valToPos(current.highCutHz, "x"), y: u.valToPos(0, "db"), off: current.highCutHz >= HIGH_CUT_OFF },
    ];
    return list;
  };

  const move = (target: EqTarget, freq: number, gain: number) => {
    const s = state.current;
    if (target === "lowCut") s.onChange({ lowCutHz: Math.min(2000, roundHz(freq)) });
    else if (target === "highCut") s.onChange({ highCutHz: Math.max(1000, roundHz(freq)) });
    else
      s.onChange({
        bands: withBand(s.eq, target, { freqHz: roundHz(freq), gainDb: Math.round(Math.min(EQ_GAIN_LIMIT, Math.max(-EQ_GAIN_LIMIT, gain)) * 10) / 10 }),
      });
  };

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
          spec: { range: SPECTRUM_RANGE },
        },
        axes: [
          freqAxis(el),
          { ...axisStyle(el), scale: "db", size: 34, splits: () => [-12, -6, 0, 6, 12], values: (_u, s) => s.map((v) => (v > 0 ? `+${v}` : String(v))) },
        ],
        series: [
          {},
          {
            scale: "spec",
            stroke: () => token(el, "--muted-foreground", 0.35),
            fill: () => token(el, "--muted-foreground", 0.12),
            width: 1,
            points: { show: false },
            // Von unten füllen; uPlot füllt bei nur negativen Werten sonst zur Oberkante.
            fillTo: SPECTRUM_RANGE[0],
          },
          { scale: "spec", stroke: () => token(el, "--ch-mic", 0.45), fill: () => token(el, "--ch-mic", 0.14), fillTo: SPECTRUM_RANGE[0], width: 1, points: { show: false } },
          { scale: "db", stroke: () => token(el, "--ch-mic"), fill: () => token(el, "--ch-mic", 0.08), fillTo: 0, width: 2.5, points: { show: false } },
        ],
        hooks: {
          draw: [
            (u) => {
              const s = state.current;
              const pr = uPlot.pxRatio;
              const accent = token(el, "--ch-mic");
              const list = handles(u, s.eq);
              // Der gewählte Punkt zuletzt, damit er über den anderen liegt.
              list.sort((a, b) => Number(a.target === s.selected) - Number(b.target === s.selected));
              for (const h of list) {
                const x = u.bbox.left + h.x * pr;
                const y = u.bbox.top + h.y * pr;
                const chosen = h.target === s.selected;
                if (chosen) dot(u, x, y, accent, "white");
                else ring(u, x, y, h.off ? token(el, "--muted-foreground", 0.7) : accent, token(el, "--panel-raised"));
              }
              const chosen = list.find((h) => h.target === s.selected);
              if (chosen) {
                const t = s.selected;
                const text =
                  typeof t === "number"
                    ? `${s.name(t)} · ${formatHz(s.eq.bands[t].freqHz)} · ${s.eq.bands[t].gainDb > 0 ? "+" : ""}${s.eq.bands[t].gainDb.toFixed(1)} dB`
                    : `${s.name(t)} · ${chosen.off ? s.offText : formatHz(t === "lowCut" ? s.eq.lowCutHz : s.eq.highCutHz)}`;
                tag(u, u.bbox.left + chosen.x * pr, u.bbox.top + chosen.y * pr, text, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
              }
            },
          ],
          ready: [
            (u) => {
              const over = u.over;
              over.style.touchAction = "none";
              const local = (e: MouseEvent) => {
                const r = over.getBoundingClientRect();
                return [e.clientX - r.left, e.clientY - r.top] as const;
              };
              /** Punkt unter dem Zeiger, sonst das Band mit der nächsten Frequenz. */
              const pick = (x: number, y: number) => {
                const list = handles(u, state.current.eq);
                const near = list.map((h) => ({ h, d: Math.hypot(h.x - x, h.y - y) })).sort((a, b) => a.d - b.d)[0];
                if (near && near.d < 16) return { target: near.h.target, dx: near.h.x - x, dy: near.h.y - y };
                const bands = list.filter((h) => typeof h.target === "number");
                const nearest = bands.reduce((best, h) => (Math.abs(h.x - x) < Math.abs(best.x - x) ? h : best), bands[0]);
                return { target: nearest.target, dx: 0, dy: 0 };
              };
              over.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                over.setPointerCapture(e.pointerId);
                const [x, y] = local(e);
                const grab = pick(x, y);
                state.current.drag = grab;
                state.current.onSelect(grab.target);
                // Ein Klick neben die Punkte holt das nächste Band gleich unter den Zeiger.
                if (grab.dx === 0 && grab.dy === 0) move(grab.target, u.posToVal(x, "x"), u.posToVal(y, "db"));
              });
              over.addEventListener("pointermove", (e) => {
                const grab = state.current.drag;
                if (!grab || !over.hasPointerCapture(e.pointerId)) return;
                const [x, y] = local(e);
                move(grab.target, u.posToVal(x + grab.dx, "x"), u.posToVal(y + grab.dy, "db"));
              });
              const end = () => (state.current.drag = null);
              over.addEventListener("pointerup", end);
              over.addEventListener("lostpointercapture", end);
              over.addEventListener("dblclick", (e) => {
                const [x, y] = local(e);
                const { target } = pick(x, y);
                const s = state.current;
                if (target === "lowCut") s.onChange({ lowCutHz: LOW_CUT_OFF });
                else if (target === "highCut") s.onChange({ highCutHz: HIGH_CUT_OFF });
                else s.onChange({ bands: withBand(s.eq, target, { gainDb: 0 }) });
              });
              // Mausrad: Breite des gewählten Bands (nach oben schmaler).
              over.addEventListener(
                "wheel",
                (e) => {
                  const s = state.current;
                  if (typeof s.selected !== "number") return;
                  e.preventDefault();
                  const band = s.eq.bands[s.selected];
                  const q = band.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12);
                  const clamped = Math.min(maxQ(s.selected, s.eq.bands.length), Math.max(0.3, q));
                  s.onChange({ bands: withBand(s.eq, s.selected, { q: Math.round(clamped * 100) / 100 }) });
                },
                { passive: false },
              );
            },
          ],
        },
      })}
    />
  );
}

/** Nicht gewählter Punkt: farbiger Ring auf Grund der Fläche. */
function ring(u: uPlot, x: number, y: number, color: string, fill: string) {
  const ctx = u.ctx;
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 5.5 * pr, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2 * pr;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
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
        scales: { x: { time: false, distr: 3, log: 10, range: [20, 20000] }, spec: { range: SPECTRUM_RANGE } },
        axes: [freqAxis(el), { ...axisStyle(el), scale: "spec", size: 34, splits: () => [-80, -60, -40, -20, 0], values: (_u, s) => s.map(String) }],
        series: [
          {},
          {
            scale: "spec",
            stroke: () => token(el, "--muted-foreground", 0.5),
            fill: () => token(el, "--muted-foreground", 0.14),
            width: 1,
            points: { show: false },
            // Von unten füllen; uPlot füllt bei nur negativen Werten sonst zur Oberkante.
            fillTo: SPECTRUM_RANGE[0],
          },
        ],
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
        axes: [{ show: false }, { ...axisStyle(el), scale: "level", size: 34, splits: () => splits, values: (_u, s) => s.map(String) }],
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
