import { Module, ReverbDisplay, Stack } from "~/components/effects/rack";
import { CassetteTape, Lightning, Megaphone, Phone, Radio, Robot, WaveSquare } from "@phosphor-icons/react";
import { PushButtons } from "~/components/ui/hardware";
import { Knob, parseNumber } from "~/components/ui/knob";
import type { CharacterMode, ModulationMode } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";

const percent = (v: number) => `${Math.round(v * 100)} %`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

/* ---------- Charakter ---------- */

const MODES: { id: CharacterMode; icon: React.ReactNode }[] = [
  { id: "robot", icon: <Robot /> },
  { id: "radio", icon: <Radio /> },
  { id: "telephone", icon: <Phone /> },
  { id: "megaphone", icon: <Megaphone /> },
  { id: "distortion", icon: <Lightning /> },
  { id: "bitcrusher", icon: <WaveSquare /> },
  { id: "lofi", icon: <CassetteTape /> },
];

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
    case "lofi":
      return { label: t("voice.brightness"), value: hz(2000 * Math.pow(3, tone)) };
  }
}

export function CharacterModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.character);
  const tone = toneOf(p.mode, p.tone);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.character")}
      help="character"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("character", { enabled })}
      keys={
        <PushButtons
          value={p.mode}
          onChange={(mode: CharacterMode) => actions.setVoice("character", { mode })}
          options={MODES.map((m) => ({ value: m.id, label: m.icon, title: t(`voice.mode.${m.id}`) }))}
        />
      }
    >
      <Stack>
        <Knob
          size="sm"
          label={t("voice.amount")}
          value={p.amount}
          min={0}
          max={1}
          step={0.01}
          reset={0.5}
          format={percent}
          onChange={(amount) => actions.setVoice("character", { amount })}
        />
        <Knob
          size="sm"
          label={tone.label}
          value={p.tone}
          min={0}
          max={1}
          step={0.01}
          reset={0.5}
          format={() => tone.value}
          onChange={(v) => actions.setVoice("character", { tone: v })}
        />
      </Stack>
      <Knob
        size="sm"
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={1}
        format={percent}
        onChange={(mix) => actions.setVoice("character", { mix })}
      />
    </Module>
  );
}

/* ---------- Modulation ---------- */

const MOD_MODES: ModulationMode[] = ["chorus", "flanger", "phaser"];
export function ModulationModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.modulation);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.modulation")}
      help="modulation"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("modulation", { enabled })}
      keys={
        <PushButtons
          value={p.mode}
          onChange={(mode: ModulationMode) => actions.setVoice("modulation", { mode })}
          options={MOD_MODES.map((m) => ({ value: m, label: t(`voice.mod.${m}`) }))}
        />
      }
    >
      <Stack>
        <Knob
          size="sm"
          label={t("voice.rate")}
          value={p.rateHz}
          min={0.05}
          max={8}
          step={0.05}
          reset={0.8}
          format={(v) => `${v.toFixed(2)} Hz`}
          onChange={(rateHz) => actions.setVoice("modulation", { rateHz })}
        />
        <Knob
          size="sm"
          label={t("voice.depth")}
          value={p.depth}
          min={0}
          max={1}
          step={0.01}
          reset={0.5}
          format={percent}
          onChange={(depth) => actions.setVoice("modulation", { depth })}
        />
        <Knob
          size="sm"
          label={t("voice.feedback")}
          value={p.feedback}
          min={0}
          max={0.9}
          step={0.01}
          reset={0.3}
          format={percent}
          disabled={p.mode === "chorus"}
          onChange={(feedback) => actions.setVoice("modulation", { feedback })}
        />
      </Stack>
      <Knob
        size="sm"
        label={t("voice.mix")}
        value={p.mix}
        min={0}
        max={1}
        step={0.01}
        reset={0.5}
        format={percent}
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
      <Stack>
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
          parse={(text) => {
            const hz = parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
            return hz && hz > 0 ? Math.log2(hz) : null;
          }}
          min={Math.log2(500)}
          max={Math.log2(16000)}
          step={0.01}
          reset={Math.log2(4000)}
          format={(v) => hz(Math.pow(2, v))}
          disabled={disabled}
          color={color}
          onChange={(v) => onChange({ toneHz: Math.round(Math.pow(2, v)) })}
        />
      </Stack>
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
      <Stack>
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
      </Stack>
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

export function EchoModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.echo);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.echo")}
      help="echo"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("echo", { enabled })}
    >
      <EchoControls params={p} onChange={(patch) => actions.setVoice("echo", patch)} />
    </Module>
  );
}

export function ReverbModule({ highlight, className }: { highlight?: boolean; className?: string }) {
  const p = useStore((s) => s.effects.voice.reverb);
  return (
    <Module
      highlight={highlight}
      className={className}
      title={t("voice.reverb")}
      help="reverb"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setVoice("reverb", { enabled })}
      display={<ReverbDisplay size={p.size} damping={p.damping} predelayMs={p.predelayMs} mix={p.mix} />}
    >
      <ReverbControls params={p} onChange={(patch) => actions.setVoice("reverb", patch)} />
    </Module>
  );
}
