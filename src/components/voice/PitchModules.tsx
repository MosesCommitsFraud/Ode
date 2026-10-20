import { useEffect, useRef, useState } from "react";
import { Module, Stack } from "~/components/effects/rack";
import { PushButton, PushButtons } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
import type { Chord, Scale } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { inScale, keyName, noteName, noteOf } from "./icons";

const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/* ---------- Tonhöhe & Formant ---------- */

export function PitchModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.pitch);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.pitch")}
      help="pitch"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("pitch", { enabled })}
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
            ? "absolute top-0 z-10 h-[58%] w-[9%] -translate-x-1/2 rounded-b-[4px] bg-foreground/80 text-background/70"
            : "relative h-full flex-1 rounded-b-[5px] bg-panel-raised text-muted-foreground shadow-[0_0_0_1px_var(--hairline)]",
          on && "!bg-[var(--ch-mic)] !text-white",
        )}
        style={black ? { left: `${(blackAt[n] / 7) * 100}%` } : undefined}
      >
        {inside && !on && <span className={cn("mb-1 size-1 rounded-full", black ? "bg-background/60" : "bg-[var(--ch-mic)]")} />}
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

export function AutotuneModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.autotune);
  return (
    <Module
      highlight={highlight}
      className={className}
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
      onToggle={(enabled) => actions.setVoice("harmonizer", { enabled })}
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
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.vocoder")}
      help="vocoder"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("vocoder", { enabled })}
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
