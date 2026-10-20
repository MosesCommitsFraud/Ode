import { useEffect, useRef, useState } from "react";
import { GridLine, Module, PLOT, Range, Reading, Tick, Toggle, freqX } from "~/components/effects/rack";
import { Bars, cssColor } from "~/components/ui/canvas";
import { Pill, PillGroup } from "~/components/ui/pills";
import { Select } from "~/components/ui/select";
import type { Chord, Scale } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
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

const SPEC_TICKS: [number, string][] = [
  [100, "100"],
  [500, "500"],
  [1000, "1k"],
  [5000, "5k"],
];

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
          {SPEC_TICKS.map(([f]) => (
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
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {SPEC_TICKS.map(([f, label]) => (
          <Tick key={f} axis="x" at={freqX(f)}>
            {label}
          </Tick>
        ))}
      </div>
    </>
  );
}

export function PitchModule() {
  const p = useStore((s) => s.effects.voice.pitch);
  const pitchHz = usePitch();
  const sung = pitchHz > 0 ? noteOf(pitchHz) : null;
  return (
    <Module
      title={t("voice.pitch")}
      columns={2}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("pitch", { enabled })}
      status={
        p.enabled &&
        sung !== null && (
          <Reading tone="primary">
            {noteName(sung)} → {noteName(sung + p.semitones)}
          </Reading>
        )
      }
      display={<PitchDisplay semitones={p.enabled ? p.semitones : 0} formant={p.enabled ? p.formant : 0} pitchHz={pitchHz} />}
    >
      <Range
        label={t("voice.semitones")}
        value={p.semitones}
        min={-12}
        max={12}
        step={1}
        format={(v) => signed(v)}
        disabled={!p.enabled}
        onChange={(semitones) => actions.setVoice("pitch", { semitones })}
      />
      <Range
        label={t("voice.formant")}
        value={p.formant}
        min={-8}
        max={8}
        step={0.5}
        format={(v) => signed(v, 1)}
        disabled={!p.enabled}
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
      <div className={PLOT}>
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
      <div className="pointer-events-none absolute top-3 bottom-6 left-0 w-9">
        {notes
          .filter((n) => inScale(n, keyNote, scale) && (scale !== "chromatic" || n % 2 === 0))
          .map((n) => (
            <Tick key={n} axis="y" at={y(n)}>
              {noteName(n)}
            </Tick>
          ))}
      </div>
    </>
  );
}

const SCALES: Scale[] = ["chromatic", "major", "minor", "pentatonic", "blues"];

export function AutotuneModule() {
  const p = useStore((s) => s.effects.voice.autotune);
  const target = useStore((s) => (s.info ? (s.meters?.effects.targetNote ?? -1) : -1));
  const cents = useStore((s) => s.meters?.effects.correctionCents ?? 0);
  return (
    <Module
      title={t("voice.autotune")}
      columns={3}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("autotune", { enabled })}
      status={
        p.enabled && (
          <Reading tone={target >= 0 ? "primary" : "default"}>
            {target >= 0 ? `${noteName(target)} ${signed(Math.round(cents))} ct` : t("voice.noPitch")}
          </Reading>
        )
      }
      display={<TuneDisplay keyNote={p.key} scale={p.scale} enabled={p.enabled} />}
    >
      <div className={p.enabled ? undefined : "opacity-45"}>
        <div className="mb-1.5 text-2xs text-muted-foreground">{t("voice.key")}</div>
        <Select
          value={String(p.key)}
          disabled={!p.enabled}
          onChange={(v) => actions.setVoice("autotune", { key: Number(v) })}
          options={Array.from({ length: 12 }, (_, k) => ({ value: String(k), label: keyName(k) }))}
          className="h-8"
        />
      </div>
      <div className={p.enabled ? undefined : "opacity-45"}>
        <div className="mb-1.5 text-2xs text-muted-foreground">{t("voice.scale")}</div>
        <Select
          value={p.scale}
          disabled={!p.enabled}
          onChange={(v) => actions.setVoice("autotune", { scale: v as Scale })}
          options={SCALES.map((s) => ({ value: s, label: t(`voice.scale.${s}`) }))}
          className="h-8"
        />
      </div>
      <Range
        label={t("voice.speed")}
        value={p.speed}
        min={0}
        max={1}
        step={0.01}
        reset={0.3}
        format={(v) => (v < 0.05 ? t("voice.instant") : `${Math.round(v * v * 400)} ms`)}
        disabled={!p.enabled}
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
    <div className="absolute inset-x-3 top-3 bottom-6 flex items-end gap-px">
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
            {(i % 12 === 0 || i === 7 || i === -5 || i === 4 || i === -8) && (
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground/70 tabular-nums">
                {i > 0 ? `+${i}` : i}
              </span>
            )}
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
      columns={3}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("harmonizer", { enabled })}
      display={<HarmonyDisplay voices={p.voices} enabled={p.enabled} />}
    >
      {([0, 1] as const).map((i) => {
        const v = p.voices[i];
        const off = !p.enabled || !v.enabled;
        return [
          <Toggle
            key={`t${i}`}
            label={t("voice.voiceN", { n: i + 1 })}
            checked={v.enabled}
            disabled={!p.enabled}
            onChange={(enabled) => setVoice(i, { enabled })}
          />,
          <Range
            key={`i${i}`}
            label={t("voice.interval")}
            value={v.semitones}
            min={-12}
            max={12}
            step={1}
            reset={i === 0 ? 4 : 7}
            format={(x) => signed(x)}
            disabled={off}
            onChange={(semitones) => setVoice(i, { semitones })}
          />,
          <Range
            key={`l${i}`}
            label={t("voice.level")}
            value={v.level}
            min={0}
            max={1}
            step={0.01}
            reset={0.6}
            format={(x) => `${Math.round(x * 100)} %`}
            disabled={off}
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
  const pitchHz = usePitch();
  const values = (bands ?? Array(16).fill(0)).map((v) => Math.min(1, Math.sqrt(v * 6)));
  return (
    <Module
      title={t("voice.vocoder")}
      columns={3}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("vocoder", { enabled })}
      status={
        p.enabled && (
          <Reading tone="primary">{p.follow ? (pitchHz > 0 ? noteName(noteOf(pitchHz)) : "—") : noteName(p.note)}</Reading>
        )
      }
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
    >
      <div className={`col-span-2 ${p.enabled ? "" : "opacity-45"}`}>
        <PillGroup size="sm" className="w-fit">
          {CHORDS.map((c) => (
            <Pill key={c} active={p.chord === c} disabled={!p.enabled} onClick={() => actions.setVoice("vocoder", { chord: c })}>
              {t(`voice.chord.${c}`)}
            </Pill>
          ))}
        </PillGroup>
      </div>
      <Toggle label={t("voice.follow")} checked={p.follow} disabled={!p.enabled} onChange={(follow) => actions.setVoice("vocoder", { follow })} />
      <Range
        label={t("voice.note")}
        value={p.note}
        min={28}
        max={76}
        step={1}
        reset={48}
        format={(v) => noteName(v)}
        disabled={!p.enabled || p.follow}
        onChange={(note) => actions.setVoice("vocoder", { note })}
      />
      <Range
        label={t("voice.breath")}
        value={p.breath}
        min={0}
        max={1}
        step={0.01}
        reset={0.2}
        format={(v) => `${Math.round(v * 100)} %`}
        disabled={!p.enabled}
        onChange={(breath) => actions.setVoice("vocoder", { breath })}
      />
      <Range
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={1}
        format={(v) => `${Math.round(v * 100)} %`}
        disabled={!p.enabled}
        onChange={(mix) => actions.setVoice("vocoder", { mix })}
      />
    </Module>
  );
}
