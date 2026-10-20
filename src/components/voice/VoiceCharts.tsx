import { useEffect, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import { axisStyle, dot, draggable, FONT, Plot, tag, token, useHistory } from "~/components/effects/charts";
import { engine, isTauri, type Scale, type VoicePreview, type VoiceParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { useStore } from "~/lib/store";
import { inScale, noteName, noteOf } from "./icons";

/*
 * Bedienbare Grafiken der Stimm-Effekte (uPlot). Echo, Hall und Charakter
 * zeigen Kurven, die die Engine mit dem echten Effekt rechnet; ziehen stellt
 * die wichtigsten Werte direkt ein.
 */

const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Kurve eines Stimm-Effekts: in der App aus der Engine (echter Effekt), in
 * der Browser-Vorschau grob nachgerechnet.
 */
function usePreview(preview: VoicePreview, fallback: () => number[]) {
  const [curve, setCurve] = useState<number[]>(fallback);
  const key = JSON.stringify(preview);
  useEffect(() => {
    if (!isTauri) {
      setCurve(fallback());
      return;
    }
    let current = true;
    // Kurz warten, damit beim Ziehen nicht jede Bewegung rechnet.
    const timer = window.setTimeout(() => void engine.voicePreview(preview).then((c) => current && setCurve(c)), 40);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
    // Nur bei geänderten Werten neu rechnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return curve;
}

/** uPlot mit festen Achsenbereichen, eigener Zeichnung und Ziehen. */
function Pad({
  x,
  y,
  data,
  axes,
  series,
  draw,
  onDrag,
}: {
  x: [number, number];
  y: [number, number];
  data?: AlignedData;
  axes: (el: HTMLElement) => uPlot.Axis[];
  series?: (el: HTMLElement) => uPlot.Series[];
  draw: (u: uPlot, el: HTMLElement) => void;
  onDrag?: (x: number, y: number, start: boolean) => void;
}) {
  const state = useRef({ draw, onDrag });
  state.current = { draw, onDrag };
  const plotData: AlignedData = data ?? [x, [y[0], y[1]]];
  return (
    <Plot
      data={plotData}
      build={(el): Omit<Options, "width" | "height"> => ({
        padding: [10, 14, 0, 0],
        legend: { show: false },
        cursor: { show: false, drag: { x: false, y: false } },
        scales: { x: { time: false, range: x }, y: { range: y } },
        axes: axes(el),
        series: series ? series(el) : [{}, { show: false }],
        hooks: {
          draw: [(u) => state.current.draw(u, el)],
          ready: [(u) => state.current.onDrag && draggable(u, (a, b, start) => state.current.onDrag?.(a, b, start), { x: "x", y: "y" })],
        },
      })}
    />
  );
}

const pr = () => uPlot.pxRatio;

function line(u: uPlot, x1: number, y1: number, x2: number, y2: number, color: string, width = 1, dash?: number[]) {
  const ctx = u.ctx;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * pr();
  if (dash) ctx.setLineDash(dash.map((d) => d * pr()));
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/* ---------- Tonhöhe: XY-Feld ---------- */

/** Waagrecht Formant, senkrecht Halbtöne; der Punkt lässt sich frei ziehen. */
export function PitchPad({ semitones, formant, onChange }: { semitones: number; formant: number; onChange: (semitones: number, formant: number) => void }) {
  return (
    <Pad
      x={[-8, 8]}
      y={[-12, 12]}
      axes={(el) => [
        { ...axisStyle(el), size: 22, splits: () => [-8, -4, 0, 4, 8], values: (_u, s) => s.map((v) => signed(v)) },
        { ...axisStyle(el), size: 34, splits: () => [-12, -7, 0, 7, 12], values: (_u, s) => s.map((v) => signed(v)) },
      ]}
      draw={(u, el) => {
        const cx = u.valToPos(0, "x", true);
        const cy = u.valToPos(0, "y", true);
        const muted = token(el, "--muted-foreground", 0.45);
        line(u, cx, u.bbox.top, cx, u.bbox.top + u.bbox.height, muted, 1, [3, 3]);
        line(u, u.bbox.left, cy, u.bbox.left + u.bbox.width, cy, muted, 1, [3, 3]);
        const ctx = u.ctx;
        ctx.save();
        ctx.font = FONT.replace("10px", `${10 * pr()}px`);
        ctx.fillStyle = token(el, "--muted-foreground");
        ctx.textAlign = "right";
        ctx.fillText(`${t("voice.formant")} →`, u.bbox.left + u.bbox.width - 4 * pr(), cy - 6 * pr());
        ctx.textAlign = "left";
        ctx.fillText(`↑ ${t("voice.semitones")}`, cx + 6 * pr(), u.bbox.top + 10 * pr());
        ctx.restore();
        const x = u.valToPos(formant, "x", true);
        const y = u.valToPos(semitones, "y", true);
        dot(u, x, y, token(el, "--ch-mic"), "white");
        tag(u, x, y, `${signed(semitones)} · ${t("voice.formant")} ${signed(formant, 1)}`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
      }}
      onDrag={(f, st) => onChange(Math.round(clamp(st, -12, 12)), Math.round(clamp(f, -8, 8) * 2) / 2)}
    />
  );
}

/* ---------- Autotune: Tonhöhenverlauf ---------- */

/** Gesungene (grau) und korrigierte Tonhöhe (farbig) der letzten 6 s; Linien = erlaubte Noten. */
export function PitchTrack({ keyNote, scale }: { keyNote: number; scale: Scale }) {
  const meters = useVoiceMeters();
  const sung = meters && meters.pitchHz > 0 ? noteOf(meters.pitchHz) : null;
  const corrected = sung !== null && meters && meters.targetNote >= 0 ? sung + meters.correctionCents / 100 : null;
  const sungLine = useHistory(sung ?? Number.NaN, 6, Number.NaN);
  const correctedLine = useHistory(corrected ?? Number.NaN, 6, Number.NaN);
  // Bereich folgt der Stimme, damit die Kurve im Bild bleibt.
  const center = useRef(57);
  const recent = [...sungLine].reverse().find((v) => !Number.isNaN(v));
  if (recent !== undefined && Math.abs(recent - center.current) > 4) center.current = Math.round(recent);
  const lo = center.current - 6;
  const hi = center.current + 6;
  const x = sungLine.map((_, i) => i);
  return (
    <Pad
      x={[0, x.length - 1]}
      y={[lo, hi]}
      data={[x, sungLine.map((v) => (Number.isNaN(v) ? null : v)), correctedLine.map((v) => (Number.isNaN(v) ? null : v))] as unknown as AlignedData}
      axes={(el) => [
        { show: false },
        {
          ...axisStyle(el),
          size: 34,
          grid: { show: false },
          splits: (u) => {
            const out: number[] = [];
            const min = u.scales.y.min ?? lo;
            const max = u.scales.y.max ?? hi;
            for (let n = Math.ceil(min); n <= max; n++) if (inScale(n, keyNote, scale)) out.push(n);
            return out;
          },
          values: (_u, s) => s.map((n) => noteName(n)),
        },
      ]}
      series={(el) => [
        {},
        { stroke: () => token(el, "--muted-foreground", 0.6), width: 1.5, points: { show: false }, spanGaps: false },
        { stroke: () => token(el, "--ch-mic"), width: 2.5, points: { show: false }, spanGaps: false },
      ]}
      draw={(u, el) => {
        const min = u.scales.y.min ?? lo;
        const max = u.scales.y.max ?? hi;
        for (let n = Math.ceil(min); n <= max; n++) {
          if (!inScale(n, keyNote, scale)) continue;
          const y = u.valToPos(n, "y", true);
          line(u, u.bbox.left, y, u.bbox.left + u.bbox.width, y, token(el, "--muted-foreground", n % 12 === keyNote ? 0.4 : 0.15));
        }
      }}
    />
  );
}

function useVoiceMeters() {
  return useStore((s) => (s.info ? s.meters?.effects : undefined));
}

/* ---------- Harmonizer: Intervall-Leiste ---------- */

/**
 * Halbtöne −12 … +12 waagrecht, die eigene Stimme in der Mitte. Die zwei
 * zusätzlichen Stimmen sind Balken (Höhe = Lautstärke); Ziehen setzt
 * Abstand und Lautstärke der näheren Stimme.
 */
export function IntervalChart({
  voices,
  onChange,
}: {
  voices: VoiceParams["harmonizer"]["voices"];
  onChange: (index: 0 | 1, patch: { semitones: number; level: number }) => void;
}) {
  const active = useRef<0 | 1>(0);
  return (
    <Pad
      x={[-12.5, 12.5]}
      y={[0, 1.1]}
      axes={(el) => [
        { ...axisStyle(el), size: 22, splits: () => [-12, -7, -5, -3, 0, 3, 4, 5, 7, 12], values: (_u, s) => s.map((v) => signed(v)) },
        { show: false },
      ]}
      draw={(u, el) => {
        const ctx = u.ctx;
        const w = (u.valToPos(1, "x", true) - u.valToPos(0, "x", true)) * 0.7;
        const bottom = u.valToPos(0, "y", true);
        const bar = (semi: number, level: number, color: string) => {
          const x = u.valToPos(semi, "x", true);
          const top = u.valToPos(level, "y", true);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(x - w / 2, top, w, bottom - top, 3 * pr());
          ctx.fill();
        };
        for (let s = -12; s <= 12; s++) bar(s, 0.04, token(el, "--muted-foreground", 0.15));
        bar(0, 1, token(el, "--foreground", 0.55));
        voices.forEach((v, i) => {
          if (!v.enabled) return;
          bar(v.semitones, Math.max(0.06, v.level), token(el, "--ch-mic"));
          const x = u.valToPos(v.semitones, "x", true);
          const y = u.valToPos(Math.max(0.06, v.level), "y", true);
          dot(u, x, y, token(el, "--ch-mic"), "white");
          tag(u, x, y, `${t("voice.voiceN", { n: i + 1 })} ${signed(v.semitones)} · ${Math.round(v.level * 100)} %`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
        });
      }}
      onDrag={(semi, level, start) => {
        if (start) {
          const distance = (i: 0 | 1) => (voices[i].enabled ? Math.abs(voices[i].semitones - semi) : Infinity);
          active.current = distance(0) <= distance(1) ? 0 : 1;
        }
        onChange(active.current, { semitones: Math.round(clamp(semi, -12, 12)), level: Math.round(clamp(level, 0, 1) * 100) / 100 });
      }}
    />
  );
}

/* ---------- Charakter: Welle vorher und nachher ---------- */

/** Zwei Schwingungen eines Tons: gestrichelt vorher, farbig nach dem echten Effekt. */
export function WaveChart({ params }: { params: VoiceParams["character"] }) {
  const wave = usePreview({ kind: "character", params }, () =>
    Array.from({ length: 200 }, (_, i) => {
      const s = Math.sin((Math.PI * 4 * i) / 200) * 0.8;
      return Math.tanh(s * (1 + params.amount * 6)) * 0.8;
    }),
  );
  const x = wave.map((_, i) => i);
  const dry = x.map((i) => Math.sin((Math.PI * 4 * i) / wave.length) * 0.8);
  return (
    <Pad
      x={[0, Math.max(1, x.length - 1)]}
      y={[-1.1, 1.1]}
      data={[x, dry, wave]}
      axes={() => [{ show: false }, { show: false }]}
      series={(el) => [
        {},
        { stroke: () => token(el, "--muted-foreground", 0.5), width: 1, dash: [4, 4], points: { show: false } },
        { stroke: () => token(el, "--ch-mic"), width: 2.5, points: { show: false } },
      ]}
      draw={(u, el) => line(u, u.bbox.left, u.valToPos(0, "y", true), u.bbox.left + u.bbox.width, u.valToPos(0, "y", true), token(el, "--muted-foreground", 0.2))}
    />
  );
}

/* ---------- Modulation: LFO ---------- */

/**
 * Bewegung der Modulation über 2 s. Waagrecht ziehen ändert das Tempo
 * (weiter links = schneller), senkrecht die Tiefe.
 */
export function LfoChart({ rate, depth, onChange }: { rate: number; depth: number; onChange: (rate: number, depth: number) => void }) {
  const n = 240;
  const x = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2);
  const y = x.map((s) => Math.sin(2 * Math.PI * rate * s) * depth);
  return (
    <Pad
      x={[0, 2]}
      y={[-1.1, 1.1]}
      data={[x, y]}
      axes={(el) => [{ ...axisStyle(el), size: 22, splits: () => [0, 0.5, 1, 1.5, 2], values: (_u, s) => s.map((v) => `${v} s`) }, { show: false }]}
      series={(el) => [{}, { stroke: () => token(el, "--ch-mic"), width: 2.5, fill: () => token(el, "--ch-mic", 0.1), points: { show: false } }]}
      draw={(u, el) => {
        // Griff am ersten Gipfel: dort sitzt die Tiefe, sein Abstand zeigt das Tempo.
        const peak = 1 / (4 * rate);
        if (peak > 2) return;
        const px = u.valToPos(peak, "x", true);
        const py = u.valToPos(depth, "y", true);
        dot(u, px, py, token(el, "--ch-mic"), "white");
        tag(u, px, py, `${rate.toFixed(2)} Hz · ${Math.round(depth * 100)} %`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
      }}
      onDrag={(s, d) => onChange(Math.round(clamp(1 / (4 * Math.max(s, 0.03)), 0.05, 8) * 20) / 20, Math.round(clamp(d, 0, 1) * 100) / 100)}
    />
  );
}

/* ---------- Echo: Wiederholungen ---------- */

/** Wiederholungen über 2 s, mit dem echten Echo gerechnet. Ziehen: waagrecht die Zeit, senkrecht die Rückkopplung. */
export function TapsChart({ params, onChange }: { params: VoiceParams["echo"]; onChange: (patch: { timeMs: number; feedback: number }) => void }) {
  const taps = usePreview({ kind: "echo", params }, () =>
    Array.from({ length: 200 }, (_, i) => {
      const t = (i / 200) * 2;
      const n = Math.round(t / (params.timeMs / 1000));
      return n >= 1 && Math.abs(t - (n * params.timeMs) / 1000) < 0.006 ? Math.pow(params.feedback, n - 1) : 0;
    }),
  );
  const x = taps.map((_, i) => (i / taps.length) * 2);
  return (
    <Pad
      x={[0, 2]}
      y={[0, 1.1]}
      data={[x, taps]}
      axes={(el) => [{ ...axisStyle(el), size: 22, splits: () => [0, 0.5, 1, 1.5, 2], values: (_u, s) => s.map((v) => `${v} s`) }, { show: false }]}
      series={(el) => [{}, { stroke: () => token(el, "--ch-mic"), width: 2, fill: () => token(el, "--ch-mic", 0.18), points: { show: false }, paths: uPlot.paths.bars?.({ size: [0.6, 6] }) }]}
      draw={(u, el) => {
        const px = u.valToPos(params.timeMs / 1000, "x", true);
        const py = u.valToPos(Math.max(params.feedback, 0.05), "y", true);
        line(u, u.valToPos(0, "x", true), u.bbox.top, u.valToPos(0, "x", true), u.bbox.top + u.bbox.height, token(el, "--foreground", 0.5), 2);
        dot(u, px, py, token(el, "--ch-mic"), "white");
        tag(u, px, py, `${Math.round(params.timeMs)} ms · ${t("voice.feedback")} ${Math.round(params.feedback * 100)} %`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
      }}
      onDrag={(s, f) => onChange({ timeMs: Math.round(clamp(s * 1000, 20, 1500) / 5) * 5, feedback: Math.round(clamp(f, 0, 0.95) * 100) / 100 })}
    />
  );
}

/* ---------- Hall: Abklingen ---------- */

/** Nachhall in dB über 4 s, mit dem echten Hall gerechnet. Ziehen: waagrecht die Größe (Nachhallzeit), senkrecht der Anteil. */
export function DecayChart({ params, onChange }: { params: VoiceParams["reverb"]; onChange: (patch: { size: number; mix: number }) => void }) {
  const seconds = 0.3 + 5.7 * params.size * params.size;
  const decay = usePreview({ kind: "reverb", params }, () =>
    Array.from({ length: 200 }, (_, i) => {
      const t = (i / 200) * 4 - params.predelayMs / 1000;
      return t < 0 ? -80 : Math.max(-80, (-60 * t) / seconds);
    }),
  );
  const x = decay.map((_, i) => (i / decay.length) * 4);
  return (
    <Pad
      x={[0, 4]}
      y={[-80, 4]}
      data={[x, decay]}
      axes={(el) => [
        { ...axisStyle(el), size: 22, splits: () => [0, 1, 2, 3, 4], values: (_u, s) => s.map((v) => `${v} s`) },
        { ...axisStyle(el), size: 34, splits: () => [-60, -40, -20, 0], values: (_u, s) => s.map(String) },
      ]}
      series={(el) => [{}, { stroke: () => token(el, "--ch-mic"), width: 2, fill: () => token(el, "--ch-mic", 0.16), points: { show: false } }]}
      draw={(u, el) => {
        // Griff dort, wo der Hall um 60 dB gefallen ist; seine Höhe zeigt den Anteil.
        const px = u.valToPos(Math.min(seconds, 4), "x", true);
        const py = u.valToPos(-80 + params.mix * 80, "y", true);
        line(u, px, u.bbox.top, px, u.bbox.top + u.bbox.height, token(el, "--ch-mic", 0.5), 1, [4, 3]);
        dot(u, px, py, token(el, "--ch-mic"), "white");
        tag(u, px, py, `${seconds.toFixed(1)} s · ${t("voice.mix")} ${Math.round(params.mix * 100)} %`, token(el, "--foreground"), token(el, "--panel-raised", 0.92));
      }}
      onDrag={(s, db) => {
        const size = Math.sqrt(clamp((clamp(s, 0.3, 4) - 0.3) / 5.7, 0, 1));
        onChange({ size: Math.round(size * 100) / 100, mix: Math.round(clamp((db + 80) / 80, 0, 1) * 100) / 100 });
      }}
    />
  );
}
