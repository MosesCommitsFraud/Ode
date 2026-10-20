import { EchoDisplay, GridLine, Module, PLOT, ReverbDisplay, Tick } from "~/components/effects/rack";
import { Knob, StepKnob } from "~/components/ui/knob";
import type { CharacterMode, ModulationMode } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";

const percent = (v: number) => `${Math.round(v * 100)} %`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

/* ---------- Charakter ---------- */

const MODES: CharacterMode[] = ["robot", "radio", "telephone", "megaphone", "distortion", "bitcrusher"];

/** Bedeutung und Anzeige des Farb-Reglers je Modus. */
function toneOf(mode: CharacterMode, tone: number): { label: string; value: string } {
  switch (mode) {
    case "robot":
      return { label: t("voice.carrier"), value: hz(30 * Math.pow(10, tone)) };
    case "radio":
      return { label: t("voice.band"), value: hz(800 * Math.pow(2, tone * 2)) };
    case "telephone": {
      const narrow = 1 - tone * 0.5;
      return { label: t("voice.width"), value: `${Math.round(300 / narrow)}–${(3.4 * narrow).toFixed(1)}k` };
    }
    case "megaphone":
      return { label: t("voice.resonance"), value: `+${Math.round(4 + tone * 10)} dB` };
    case "distortion":
      return { label: t("voice.brightness"), value: hz(1000 * Math.pow(12, tone)) };
    case "bitcrusher":
      return { label: t("voice.sampleRate"), value: hz(48000 / (1 + Math.floor(tone * tone * 31))) };
  }
}

/** Eine Sinusschwingung einer 150-Hz-Stimme vor (gestrichelt) und nach dem Effekt. */
function CharacterDisplay({ mode, amount, tone, mix }: { mode: CharacterMode; amount: number; tone: number; mix: number }) {
  const N = 240;
  const sat = (x: number, drive: number) => Math.tanh(x * drive) / Math.tanh(drive);
  const shape = (i: number) => {
    const phase = (i / N) * 2;
    const s = Math.sin(Math.PI * 2 * phase);
    switch (mode) {
      case "robot": {
        const carrier = (30 * Math.pow(10, tone)) / 150;
        const ring = s * Math.sin(Math.PI * 2 * phase * carrier);
        return ring * (0.5 + amount * 0.5) + s * (1 - amount) * 0.5;
      }
      case "radio":
        return sat(s, 1 + amount * 8) * 0.8;
      case "megaphone":
        return sat(s, 2 + amount * 14) * 0.85;
      case "distortion":
        return sat(s + 0.1 * amount, 1 + amount * 40) * 0.9;
      case "telephone": {
        const levels = Math.round(16 - amount * 12);
        const held = Math.sin(Math.PI * 2 * (Math.floor(phase * 24) / 24));
        return sat(Math.round(held * levels) / levels, 1 + amount * 3) * 0.9;
      }
      case "bitcrusher": {
        const levels = Math.min(64, Math.pow(2, 15 - amount * 14));
        const steps = 320 / (1 + Math.floor(tone * tone * 31));
        const held = Math.sin(Math.PI * 2 * (Math.floor(phase * steps) / steps));
        return Math.round(held * levels) / levels;
      }
    }
  };
  const y = (v: number) => 50 - v * 42;
  const dry = Array.from({ length: N + 1 }, (_, i) => `${(i / N) * 100},${y(Math.sin((Math.PI * 4 * i) / N))}`).join(" ");
  const wet = Array.from({ length: N + 1 }, (_, i) => {
    const s = Math.sin((Math.PI * 4 * i) / N);
    return `${(i / N) * 100},${y(s * (1 - mix) + shape(i) * mix)}`;
  }).join(" ");
  return (
    <div className="absolute inset-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
        <GridLine y={50} />
        <polyline points={dry} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <polyline points={wet} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span className="absolute top-0 right-0 font-mono text-[9px] text-muted-foreground/80">{t(`voice.mode.${mode}`)}</span>
    </div>
  );
}

export function CharacterModule() {
  const p = useStore((s) => s.effects.voice.character);
  const tone = toneOf(p.mode, p.tone);
  return (
    <Module
      title={t("voice.character")}
      columns={4}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("character", { enabled })}
      display={<CharacterDisplay mode={p.mode} amount={p.amount} tone={p.tone} mix={p.mix} />}
    >
      <StepKnob
        label={t("voice.modeLabel")}
        value={p.mode}
        disabled={!p.enabled}
        onChange={(mode: CharacterMode) => actions.setVoice("character", { mode })}
        options={MODES.map((m) => ({ value: m, label: t(`voice.mode.${m}`) }))}
      />
      <Knob
        label={t("voice.amount")}
        value={p.amount}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={percent}
        disabled={!p.enabled}
        onChange={(amount) => actions.setVoice("character", { amount })}
      />
      <Knob
        label={tone.label}
        value={p.tone}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={() => tone.value}
        disabled={!p.enabled}
        onChange={(v) => actions.setVoice("character", { tone: v })}
      />
      <Knob
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={1}
        format={percent}
        disabled={!p.enabled}
        onChange={(mix) => actions.setVoice("character", { mix })}
      />
    </Module>
  );
}

/* ---------- Modulation ---------- */

const MOD_MODES: ModulationMode[] = ["chorus", "flanger", "phaser"];
const MOD_SPAN = 2;

/** Verlauf des LFO über 2 s; beim Chorus die drei versetzten Stimmen. */
function ModulationDisplay({ mode, rateHz, depth }: { mode: ModulationMode; rateHz: number; depth: number }) {
  const N = 200;
  const voices = mode === "chorus" ? [0, 1 / 3, 2 / 3] : [0];
  const curve = (offset: number) =>
    Array.from({ length: N + 1 }, (_, i) => {
      const time = (i / N) * MOD_SPAN;
      const v = Math.sin(Math.PI * 2 * (time * rateHz + offset));
      return `${(i / N) * 100},${50 - v * depth * 40}`;
    }).join(" ");
  const ticks = [0, 0.5, 1, 1.5, 2];
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((s) => (
            <GridLine key={s} x={(s / MOD_SPAN) * 100} />
          ))}
          <GridLine y={50} strong />
          {voices.map((o, i) => (
            <polyline
              key={o}
              points={curve(o)}
              fill="none"
              stroke="var(--ch-mic)"
              strokeOpacity={i === 0 ? 1 : 0.45}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {ticks.map((s) => (
          <Tick key={s} axis="x" at={(s / MOD_SPAN) * 100}>
            {s} s
          </Tick>
        ))}
      </div>
    </>
  );
}

export function ModulationModule() {
  const p = useStore((s) => s.effects.voice.modulation);
  return (
    <Module
      title={t("voice.modulation")}
      columns={5}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("modulation", { enabled })}
      display={<ModulationDisplay mode={p.mode} rateHz={p.rateHz} depth={p.depth} />}
    >
      <StepKnob
        label={t("voice.modeLabel")}
        value={p.mode}
        disabled={!p.enabled}
        onChange={(mode: ModulationMode) => actions.setVoice("modulation", { mode })}
        options={MOD_MODES.map((m) => ({ value: m, label: t(`voice.mod.${m}`) }))}
      />
      <Knob
        label={t("voice.rate")}
        value={p.rateHz}
        min={0.05}
        max={8}
        step={0.05}
        reset={0.8}
        format={(v) => `${v.toFixed(2)} Hz`}
        disabled={!p.enabled}
        onChange={(rateHz) => actions.setVoice("modulation", { rateHz })}
      />
      <Knob
        label={t("voice.depth")}
        value={p.depth}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={percent}
        disabled={!p.enabled}
        onChange={(depth) => actions.setVoice("modulation", { depth })}
      />
      <Knob
        label={t("voice.feedback")}
        value={p.feedback}
        min={0}
        max={0.9}
        step={0.01}
        reset={0.3}
        format={percent}
        disabled={!p.enabled || p.mode === "chorus"}
        onChange={(feedback) => actions.setVoice("modulation", { feedback })}
      />
      <Knob
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={percent}
        disabled={!p.enabled}
        onChange={(mix) => actions.setVoice("modulation", { mix })}
      />
    </Module>
  );
}

/* ---------- Echo und Hall ---------- */

/** Regler für Echo und Hall, auch auf den Effekt-Bussen des Pults. */
export function EchoControls({
  params,
  onChange,
  disabled,
  mixLabel = t("voice.mix"),
  color,
}: {
  params: { timeMs: number; feedback: number; toneHz: number; mix: number };
  onChange: (patch: Partial<{ timeMs: number; feedback: number; toneHz: number; mix: number }>) => void;
  disabled?: boolean;
  mixLabel?: string;
  color?: string;
}) {
  return (
    <>
      <Knob
        label={t("voice.time")}
        value={params.timeMs}
        min={20}
        max={1500}
        step={5}
        reset={320}
        format={(v) => `${Math.round(v)} ms`}
        disabled={disabled}
        color={color}
        onChange={(timeMs) => onChange({ timeMs })}
      />
      <Knob
        label={t("voice.feedback")}
        value={params.feedback}
        min={0}
        max={0.95}
        step={0.01}
        reset={0.35}
        format={percent}
        disabled={disabled}
        color={color}
        onChange={(feedback) => onChange({ feedback })}
      />
      <Knob
        label={t("voice.echoTone")}
        value={Math.log2(params.toneHz)}
        min={Math.log2(500)}
        max={Math.log2(16000)}
        step={0.01}
        reset={Math.log2(4000)}
        format={(v) => hz(Math.pow(2, v))}
        disabled={disabled}
        color={color}
        onChange={(v) => onChange({ toneHz: Math.round(Math.pow(2, v)) })}
      />
      <Knob
        label={mixLabel}
        value={params.mix}
        min={0}
        max={1}
        step={0.01}
        reset={0.3}
        format={percent}
        disabled={disabled}
        color={color}
        onChange={(mix) => onChange({ mix })}
      />
    </>
  );
}

export function ReverbControls({
  params,
  onChange,
  disabled,
  mixLabel = t("voice.mix"),
  color,
}: {
  params: { size: number; damping: number; predelayMs: number; lowCutHz: number; mix: number };
  onChange: (patch: Partial<{ size: number; damping: number; predelayMs: number; lowCutHz: number; mix: number }>) => void;
  disabled?: boolean;
  mixLabel?: string;
  color?: string;
}) {
  return (
    <>
      <Knob
        label={t("voice.size")}
        value={params.size}
        min={0}
        max={1}
        step={0.01}
        reset={0.6}
        format={percent}
        disabled={disabled}
        color={color}
        onChange={(size) => onChange({ size })}
      />
      <Knob
        label={t("voice.damping")}
        value={params.damping}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={percent}
        disabled={disabled}
        color={color}
        onChange={(damping) => onChange({ damping })}
      />
      <Knob
        label={t("voice.predelay")}
        value={params.predelayMs}
        min={0}
        max={200}
        step={1}
        reset={20}
        format={(v) => `${v} ms`}
        disabled={disabled}
        color={color}
        onChange={(predelayMs) => onChange({ predelayMs })}
      />
      <Knob
        label={t("voice.lowCut")}
        value={params.lowCutHz}
        min={20}
        max={1000}
        step={10}
        reset={200}
        format={hz}
        disabled={disabled}
        color={color}
        onChange={(lowCutHz) => onChange({ lowCutHz })}
      />
      <Knob
        label={mixLabel}
        value={params.mix}
        min={0}
        max={1}
        step={0.01}
        reset={0.25}
        format={percent}
        disabled={disabled}
        color={color}
        onChange={(mix) => onChange({ mix })}
      />
    </>
  );
}

export function EchoModule() {
  const p = useStore((s) => s.effects.voice.echo);
  return (
    <Module
      title={t("voice.echo")}
      columns={4}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("echo", { enabled })}
      display={<EchoDisplay timeMs={p.timeMs} feedback={p.feedback} toneHz={p.toneHz} mix={Math.max(0.15, p.mix)} />}
    >
      <EchoControls params={p} disabled={!p.enabled} onChange={(patch) => actions.setVoice("echo", patch)} />
    </Module>
  );
}

export function ReverbModule() {
  const p = useStore((s) => s.effects.voice.reverb);
  return (
    <Module
      title={t("voice.reverb")}
      columns={5}
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("reverb", { enabled })}
      display={<ReverbDisplay size={p.size} damping={p.damping} predelayMs={p.predelayMs} mix={p.mix} />}
    >
      <ReverbControls params={p} disabled={!p.enabled} onChange={(patch) => actions.setVoice("reverb", patch)} />
    </Module>
  );
}
