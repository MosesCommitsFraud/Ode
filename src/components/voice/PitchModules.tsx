import { useEffect, useRef, useState } from "react";
import { GridLine, Module, PLOT, Stack, freqX, smooth } from "~/components/effects/rack";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButton, PushButtons } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
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


export function PitchModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.pitch);
  const pitchHz = usePitch();
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.pitch")}
      help="pitch"
      enabled={p.enabled}
      name="voice-pitch"
      onToggle={(enabled) => smooth(() => actions.setVoice("pitch", { enabled }))}
      display={<PitchDisplay semitones={p.enabled ? p.semitones : 0} formant={p.enabled ? p.formant : 0} pitchHz={pitchHz} />}
    >
      <Stack>
        <Knob
          label={t("voice.semitones")}
          value={p.semitones}
          min={-12}
          max={12}
          step={1}
          reset={0}
          bipolar
          ticks={25}
          size="lg"
          format={(v) => signed(v)}
          onChange={(semitones) => actions.setVoice("pitch", { semitones })}
        />
      </Stack>
      <Knob
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
 * Grundton als Klaviatur über eine Oktave: wie ein echtes Keyboard mit
 * weißen und schwarzen Tasten. Der Grundton ist in der Gerätefarbe gefüllt,
 * die übrigen Töne der Skala tragen einen Punkt, Töne außerhalb sind blass.
 */
function Keyboard({ value, scale, onChange }: { value: number; scale: Scale; onChange: (key: number) => void }) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  // Schwarze Tasten sitzen auf der Grenze zwischen zwei weißen; Position in Weiß-Breiten.
  const blackAt: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
  const key = (n: number, black: boolean) => {
    const root = n === value;
    const inside = inScale(n, value, scale);
    return (
      <button
        key={n}
        type="button"
        title={keyName(n)}
        aria-pressed={root}
        onClick={() => onChange(n)}
        className={cn(
          "flex cursor-default flex-col items-center justify-end gap-1 pb-1.5 transition-[background-color,color,transform] duration-150 active:translate-y-px",
          black
            ? "absolute top-0 z-10 h-[60%] w-[9.5%] -translate-x-1/2 rounded-b-[5px] shadow-[0_2px_3px_oklch(0%_0_0/35%)]"
            : "relative h-full flex-1 rounded-b-[7px] shadow-[inset_0_-3px_0_oklch(0%_0_0/6%),0_0_0_1px_var(--hairline)]",
          root
            ? "bg-[var(--ch-mic)] text-white"
            : black
              ? "bg-[oklch(24%_0.006_60)] text-white/70 hover:bg-[oklch(32%_0.006_60)] dark:bg-[oklch(12%_0.006_60)]"
              : "bg-[oklch(99.5%_0.002_75)] text-foreground hover:bg-[oklch(96%_0.004_75)] dark:bg-[oklch(88%_0.004_75)] dark:text-[oklch(20%_0_0)]",
        )}
        style={black ? { left: `${(blackAt[n] / 7) * 100}%` } : undefined}
      >
        {inside && !root && <span className={cn("size-1.5 rounded-full", black ? "bg-white/70" : "bg-[var(--ch-mic)]")} />}
        {!black && <span className={cn("font-mono text-[10px] font-semibold", !inside && !root && "opacity-35")}>{keyName(n)}</span>}
      </button>
    );
  };
  return (
    <div className="piano relative flex h-[clamp(64px,11vh,104px)] min-w-0 gap-[3px] rounded-[10px] bg-[oklch(20%_0.006_60)] p-[3px] pt-1.5" title={t("voice.key")}>
      {whites.map((n) => key(n, false))}
      <div className="pointer-events-none absolute inset-x-[3px] top-1.5 bottom-[3px] [&>*]:pointer-events-auto">{[...BLACK_KEYS].map((n) => key(n, true))}</div>
    </div>
  );
}

export function AutotuneModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.autotune);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.autotune")}
      help="autotune"
      enabled={p.enabled}
      name="voice-autotune"
      onToggle={(enabled) => smooth(() => actions.setVoice("autotune", { enabled }))}
      display={<TuneDisplay keyNote={p.key} scale={p.scale} enabled={p.enabled} />}
      keys={
        <>
          <Keyboard value={p.key} scale={p.scale} onChange={(key) => actions.setVoice("autotune", { key })} />
          <PushButtons
            value={p.scale}
            onChange={(scale: Scale) => actions.setVoice("autotune", { scale })}
            options={SCALES.map((s) => ({ value: s, label: t(`voice.scaleShort.${s}`), title: t(`voice.scale.${s}`) }))}
          />
        </>
      }
    >
      <Stack>
        <Knob
          label={t("voice.speed")}
          value={p.speed}
          min={0}
          max={1}
          step={0.01}
          reset={0.3}
          size="lg"
          format={(v) => (v < 0.05 ? t("voice.instant") : `${Math.round(v * v * 400)} ms`)}
          onChange={(speed) => actions.setVoice("autotune", { speed })}
        />
      </Stack>
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

export function HarmonizerModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.harmonizer);
  const setVoice = (index: 0 | 1, patch: Partial<(typeof p.voices)[0]>) => {
    const voices = [...p.voices] as typeof p.voices;
    voices[index] = { ...voices[index], ...patch };
    actions.setVoice("harmonizer", { voices });
  };
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.harmonizer")}
      help="harmonizer"
      enabled={p.enabled}
      name="voice-harmonizer"
      onToggle={(enabled) => smooth(() => actions.setVoice("harmonizer", { enabled }))}
      display={<HarmonyDisplay voices={p.voices} enabled={p.enabled} />}
      keys={
        <div className="grid grid-cols-2 gap-1.5">
          {([0, 1] as const).map((i) => (
            <PushButton key={i} label={t("voice.voiceN", { n: i + 1 })} on={p.voices[i].enabled} onChange={(enabled) => setVoice(i, { enabled })} />
          ))}
        </div>
      }
    >
      {([0, 1] as const).map((i) => {
        const v = p.voices[i];
        return (
          <div key={i} className="flex min-h-0 flex-1 items-stretch justify-center gap-1">
            <Stack>
              <Knob
                size="sm"
                label={t("voice.intervalN", { n: i + 1 })}
                value={v.semitones}
                min={-12}
                max={12}
                step={1}
                reset={0}
                bipolar
                ticks={25}
                format={(x) => signed(x)}
                disabled={!v.enabled}
                onChange={(semitones) => setVoice(i, { semitones })}
              />
            </Stack>
            <Knob
              size="sm"
              label={t("voice.levelN", { n: i + 1 })}
              value={v.level}
              min={0}
              max={1}
              step={0.01}
              reset={0.6}
              format={(x) => `${Math.round(x * 100)} %`}
              disabled={!v.enabled}
              onChange={(level) => setVoice(i, { level })}
            />
          </div>
        );
      })}
    </Module>
  );
}

/* ---------- Vocoder ---------- */

const CHORDS: Chord[] = ["single", "fifth", "major", "minor"];

export function VocoderModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.vocoder);
  const bands = useStore((s) => (s.info ? s.meters?.effects.vocoder : undefined));
  const values = (bands ?? Array(16).fill(0)).map((v) => Math.min(1, Math.sqrt(v * 6)));
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.vocoder")}
      help="vocoder"
      enabled={p.enabled}
      name="voice-vocoder"
      onToggle={(enabled) => smooth(() => actions.setVoice("vocoder", { enabled }))}
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
        <div className="flex gap-1.5">
          <PushButtons
            className="flex-[4]"
            value={p.chord}
            onChange={(chord: Chord) => actions.setVoice("vocoder", { chord })}
            options={CHORDS.map((c) => ({ value: c, label: t(`voice.chordShort.${c}`), title: t(`voice.chord.${c}`) }))}
          />
          <PushButton
            className="flex-[1.6]"
            label={t("voice.followShort")}
            title={t("voice.follow")}
            on={p.follow}
            onChange={(follow) => actions.setVoice("vocoder", { follow })}
          />
        </div>
      }
    >
      <Stack>
        <Knob
          label={t("voice.note")}
          value={p.note}
          min={28}
          max={76}
          step={1}
          reset={48}
          ticks={5}
          format={(v) => noteName(v)}
          disabled={p.follow}
          onChange={(note) => actions.setVoice("vocoder", { note })}
        />
        <Knob
          label={t("voice.breath")}
          value={p.breath}
          min={0}
          max={1}
          step={0.01}
          reset={0.2}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(breath) => actions.setVoice("vocoder", { breath })}
        />
      </Stack>
      <Knob
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
