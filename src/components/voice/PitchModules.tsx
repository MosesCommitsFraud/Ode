import { useEffect, useRef, useState } from "react";
import { GridLine, Module, PLOT, freqX } from "~/components/effects/rack";
import { StripToggle } from "~/components/mixer/ChannelStrip";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButtons, SlideFader } from "~/components/ui/hardware";
import type { Chord, Scale } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { inScale, keyName, noteName, noteOf } from "./icons";

const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/** Erkannte Tonhöhe, solange die Engine läuft. */
function usePitch() {
  return useStore((s) => (s.info ? (s.meters?.effects.pitchHz ?? 0) : 0));
}

/* ---------- Tonhöhe & Formant ---------- */

const FORMANTS = [
  [500, 1, 0.9],
  [1500, 0.7, 0.8],
  [2700, 0.45, 0.7],
];

/** Hüllkurve einer Stimme mit drei Formanten, 0–1. */
function envelope(f: number) {
  const lf = Math.log2(f);
  let v = 0.08;
  for (const [center, height, width] of FORMANTS) v += height * Math.exp(-Math.pow(lf - Math.log2(center), 2) / (2 * width * width * 0.25));
  return Math.min(1, v);
}

const SPEC_GRID = [100, 500, 1000, 5000];

/**
 * Obertöne der Stimme als Striche (ihr Abstand ist die Tonhöhe) unter der
 * Formant-Hüllkurve; gestrichelt die natürliche Hüllkurve.
 */
function PitchDisplay({ semitones, formant, pitchHz }: { semitones: number; formant: number; pitchHz: number }) {
  const f0 = (pitchHz || 140) * Math.pow(2, semitones / 12);
  const k = Math.pow(2, formant / 12);
  const curve = (shift: number) =>
    Array.from({ length: 81 }, (_, i) => {
      const f = 20 * Math.pow(1000, i / 80);
      return `${(i / 80) * 100},${100 - envelope(f / shift) * 88}`;
    }).join(" ");
  const harmonics: number[] = [];
  for (let f = f0; f < 16000 && harmonics.length < 60; f += f0) harmonics.push(f);

  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {SPEC_GRID.map((f) => (
            <GridLine key={f} x={freqX(f)} />
          ))}
          {harmonics.map((f) => (
            <line
              key={f}
              x1={freqX(f)}
              x2={freqX(f)}
              y1="100"
              y2={100 - envelope(f / k) * 88}
              stroke="var(--ch-mic)"
              strokeOpacity=".55"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polyline points={curve(1)} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".45" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={curve(k)} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
    </>
  );
}

export function PitchModule() {
  const p = useStore((s) => s.effects.voice.pitch);
  const pitchHz = usePitch();
  return (
    <Module
      title={t("voice.pitch")}
      help="pitch"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("pitch", { enabled })}
      display={<PitchDisplay semitones={p.enabled ? p.semitones : 0} formant={p.enabled ? p.formant : 0} pitchHz={pitchHz} />}
    >
      <SlideFader
        label={t("voice.semitones")}
        value={p.semitones}
        min={-12}
        max={12}
        step={1}
        reset={0}
        bipolar
        format={(v) => signed(v)}
        onChange={(semitones) => actions.setVoice("pitch", { semitones })}
      />
      <SlideFader
        label={t("voice.formant")}
        value={p.formant}
        min={-8}
        max={8}
        step={0.5}
        reset={0}
        bipolar
        format={(v) => signed(v, 1)}
        onChange={(formant) => actions.setVoice("pitch", { formant })}
      />
    </Module>
  );
}

/* ---------- Autotune ---------- */

const TRACK = 120;
const TRACK_MS = 50;
const SPAN = 5;

interface TrackPoint {
  sung: number | null;
  corrected: number | null;
  target: number | null;
}

/**
 * Verlauf über 6 s: gesungene Tonhöhe (grau), korrigierte (farbig) und die
 * erlaubten Noten der Tonart als Linien.
 */
function TuneDisplay({ keyNote, scale, enabled }: { keyNote: number; scale: Scale; enabled: boolean }) {
  const latest = useRef<TrackPoint>({ sung: null, corrected: null, target: null });
  const meters = useStore((s) => (s.info ? s.meters?.effects : undefined));
  const sung = meters && meters.pitchHz > 0 ? noteOf(meters.pitchHz) : null;
  latest.current = {
    sung,
    corrected: sung !== null && enabled ? sung + (meters?.correctionCents ?? 0) / 100 : null,
    target: meters && meters.targetNote >= 0 ? meters.targetNote : null,
  };
  const [track, setTrack] = useState<TrackPoint[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => setTrack((h) => [...h.slice(-(TRACK - 1)), latest.current]), TRACK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Mitte folgt der zuletzt gesungenen Note, damit die Kurve im Bild bleibt.
  const center = useRef(57);
  const recent = [...track].reverse().find((p) => p.sung !== null)?.sung;
  if (recent !== undefined && recent !== null && Math.abs(recent - center.current) > SPAN - 1.5) center.current = Math.round(recent);
  const lo = center.current - SPAN;
  const y = (note: number) => 100 - ((note - lo) / (SPAN * 2)) * 100;
  const x = (i: number) => ((i + TRACK - track.length) / (TRACK - 1)) * 100;

  const lines = (pick: (p: TrackPoint) => number | null) => {
    const segments: string[][] = [];
    let current: string[] = [];
    track.forEach((p, i) => {
      const v = pick(p);
      if (v === null || v < lo - 1 || v > lo + SPAN * 2 + 1) {
        if (current.length > 1) segments.push(current);
        current = [];
      } else current.push(`${x(i)},${y(v)}`);
    });
    if (current.length > 1) segments.push(current);
    return segments.map((s) => s.join(" "));
  };

  const notes = Array.from({ length: SPAN * 2 + 1 }, (_, i) => lo + i);
  return (
    <>
      <div className="absolute inset-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {notes.map((n) => (
            <line
              key={n}
              x1="0"
              x2="100"
              y1={y(n)}
              y2={y(n)}
              stroke={inScale(n, keyNote, scale) ? "var(--muted-foreground)" : "transparent"}
              strokeOpacity={n % 12 === keyNote ? ".45" : ".14"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {lines((p) => p.sung).map((pts, i) => (
            <polyline key={`s${i}`} points={pts} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
          {lines((p) => p.corrected).map((pts, i) => (
            <polyline key={`c${i}`} points={pts} fill="none" stroke="var(--ch-mic)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
        </svg>
      </div>
    </>
  );
}

const SCALES: Scale[] = ["chromatic", "major", "minor", "pentatonic", "blues"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/**
 * Grundton als Klaviatur: eine Oktave, die Tasten der gewählten Skala
 * tragen einen Strich, der Grundton leuchtet.
 */
function Keyboard({
  value,
  keyNote,
  scale,
  disabled,
  onChange,
}: {
  value: number;
  keyNote: number;
  scale: Scale;
  disabled?: boolean;
  onChange: (key: number) => void;
}) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  // Schwarze Tasten sitzen zwischen den weißen; Position in Weiß-Breiten.
  const blackAt: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
  const key = (n: number, black: boolean) => {
    const on = n === value;
    const inside = inScale(n, keyNote, scale);
    return (
      <button
        key={n}
        type="button"
        title={keyName(n)}
        aria-pressed={on}
        disabled={disabled}
        onClick={() => onChange(n)}
        className={cn(
          "flex cursor-default flex-col items-center justify-end pb-1 font-mono text-[9px] leading-none font-semibold transition-colors",
          black
            ? "absolute top-0 z-10 h-[58%] w-[9%] -translate-x-1/2 rounded-b-[4px] bg-[linear-gradient(to_bottom,oklch(30%_0.006_60),oklch(18%_0.006_60))] text-white/70 shadow-[0_2px_4px_oklch(0%_0_0/45%)]"
            : "relative h-full flex-1 rounded-b-[5px] bg-[linear-gradient(to_bottom,oklch(97%_0.003_75),oklch(88%_0.006_75))] text-black/60 shadow-[0_0_0_1px_oklch(0%_0_0/18%),0_2px_3px_-1px_oklch(0%_0_0/30%)]",
          on && "!bg-none !bg-[var(--ch-mic)] !text-black/80",
        )}
        style={black ? { left: `${(blackAt[n] / 7) * 100}%` } : undefined}
      >
        {inside && !on && <span className={cn("mb-1 h-[3px] w-2.5 rounded-full", black ? "bg-white/50" : "bg-black/35")} />}
        {!black && keyName(n)}
      </button>
    );
  };
  return (
    <div className={cn("relative flex h-[clamp(40px,6vh,64px)] min-w-0 gap-px", disabled && "opacity-45")} title={t("voice.key")}>
      {whites.map((n) => key(n, false))}
      {[...BLACK_KEYS].map((n) => key(n, true))}
    </div>
  );
}

export function AutotuneModule() {
  const p = useStore((s) => s.effects.voice.autotune);
  return (
    <Module
      title={t("voice.autotune")}
      help="autotune"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("autotune", { enabled })}
      display={<TuneDisplay keyNote={p.key} scale={p.scale} enabled={p.enabled} />}
      keys={
        <>
          <Keyboard value={p.key} keyNote={p.key} scale={p.scale} onChange={(key) => actions.setVoice("autotune", { key })} />
          <PushButtons
            value={p.scale}
            onChange={(scale: Scale) => actions.setVoice("autotune", { scale })}
            options={SCALES.map((s) => ({ value: s, label: t(`voice.scaleShort.${s}`), title: t(`voice.scale.${s}`) }))}
          />
        </>
      }
    >
      <SlideFader
        label={t("voice.speed")}
        value={p.speed}
        min={0}
        max={1}
        step={0.01}
        reset={0.3}
        format={(v) => (v < 0.05 ? t("voice.instant") : `${Math.round(v * v * 400)} ms`)}
        onChange={(speed) => actions.setVoice("autotune", { speed })}
      />
    </Module>
  );
}

/* ---------- Harmonizer ---------- */

const INTERVALS = Array.from({ length: 25 }, (_, i) => i - 12);
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Halbtöne um die eigene Stimme als Tasten; die Harmonien als Balken mit ihrer Lautstärke. */
function HarmonyDisplay({ voices, enabled }: { voices: { enabled: boolean; semitones: number; level: number }[]; enabled: boolean }) {
  return (
    <div className="absolute inset-3 flex items-end gap-px">
      {INTERVALS.map((i) => {
        const voice = voices.find((v) => v.enabled && Math.round(v.semitones) === i);
        const own = i === 0;
        const height = own ? 1 : voice && enabled ? 0.25 + voice.level * 0.75 : 0;
        return (
          <div key={i} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className="rounded-[3px] transition-[height] duration-200"
              style={{
                height: `${Math.max(6, height * 100)}%`,
                background: own ? "var(--foreground)" : height > 0 ? "var(--ch-mic)" : "var(--meter-track)",
                opacity: own ? 0.7 : height > 0 ? 1 : BLACK.has(((i % 12) + 12) % 12) ? 0.5 : 1,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function HarmonizerModule() {
  const p = useStore((s) => s.effects.voice.harmonizer);
  const setVoice = (index: 0 | 1, patch: Partial<(typeof p.voices)[0]>) => {
    const voices = [...p.voices] as typeof p.voices;
    voices[index] = { ...voices[index], ...patch };
    actions.setVoice("harmonizer", { voices });
  };
  return (
    <Module
      title={t("voice.harmonizer")}
      help="harmonizer"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("harmonizer", { enabled })}
      display={<HarmonyDisplay voices={p.voices} enabled={p.enabled} />}
      extra={([0, 1] as const).map((i) => (
        <StripToggle key={i} title={t("voice.voiceN", { n: i + 1 })} on={p.voices[i].enabled} onClick={() => setVoice(i, { enabled: !p.voices[i].enabled })}>
          {i + 1}
        </StripToggle>
      ))}
    >
      {([0, 1] as const).flatMap((i) => {
        const v = p.voices[i];
        return [
          <SlideFader
            key={`i${i}`}
            label={t("voice.intervalN", { n: i + 1 })}
            value={v.semitones}
            min={-12}
            max={12}
            step={1}
            reset={0}
            bipolar
            format={(x) => signed(x)}
            disabled={!v.enabled}
            onChange={(semitones) => setVoice(i, { semitones })}
          />,
          <SlideFader
            key={`l${i}`}
            label={t("voice.levelN", { n: i + 1 })}
            value={v.level}
            min={0}
            max={1}
            step={0.01}
            reset={0.6}
            format={(x) => `${Math.round(x * 100)} %`}
            disabled={!v.enabled}
            onChange={(level) => setVoice(i, { level })}
          />,
        ];
      })}
    </Module>
  );
}

/* ---------- Vocoder ---------- */

const CHORDS: Chord[] = ["single", "fifth", "major", "minor"];

export function VocoderModule() {
  const p = useStore((s) => s.effects.voice.vocoder);
  const bands = useStore((s) => (s.info ? s.meters?.effects.vocoder : undefined));
  const values = (bands ?? Array(16).fill(0)).map((v) => Math.min(1, Math.sqrt(v * 6)));
  return (
    <Module
      title={t("voice.vocoder")}
      help="vocoder"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("vocoder", { enabled })}
      display={
        <div className="absolute inset-0 p-3">
          <Bars
            values={values}
            align="bottom"
            stretch
            bar={6}
            gap={3}
            min={0.04}
            color={(_, v, el) => [cssColor(el, "--ch-mic"), 0.35 + v * 0.65]}
            deps={[values.join(",")]}
            className="size-full"
          />
        </div>
      }
      keys={
        <PushButtons
          value={p.chord}
          onChange={(chord: Chord) => actions.setVoice("vocoder", { chord })}
          options={CHORDS.map((c) => ({ value: c, label: t(`voice.chordShort.${c}`), title: t(`voice.chord.${c}`) }))}
        />
      }
      extra={
        <StripToggle title={t("voice.follow")} on={p.follow} onClick={() => actions.setVoice("vocoder", { follow: !p.follow })}>
          {t("voice.followShort")}
        </StripToggle>
      }
    >
      <SlideFader
        label={t("voice.note")}
        value={p.note}
        min={28}
        max={76}
        step={1}
        reset={48}
        format={(v) => noteName(v)}
        disabled={p.follow}
        onChange={(note) => actions.setVoice("vocoder", { note })}
      />
      <SlideFader
        label={t("voice.breath")}
        value={p.breath}
        min={0}
        max={1}
        step={0.01}
        reset={0.2}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(breath) => actions.setVoice("vocoder", { breath })}
      />
      <SlideFader
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={1}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(mix) => actions.setVoice("vocoder", { mix })}
      />
    </Module>
  );
}
