import {
  ArrowsDownUp,
  CassetteTape,
  Church,
  Lightning,
  MaskHappy,
  Megaphone,
  MusicNotes,
  Phone,
  Radio,
  Repeat,
  Robot,
  UsersThree,
  WaveSine,
  WaveSquare,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { DevicePage, ParamRow, QuickPicks, Readout, Slider } from "~/components/effects/device";
import { PushButton, PushButtons } from "~/components/ui/hardware";
import { parseNumber } from "~/components/ui/knob";
import { VOICE_DEFAULTS } from "~/lib/defaults";
import type { CharacterMode, Chord, ModulationMode, Scale, VoiceParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { inScale, keyName, noteName, noteOf } from "./icons";

/* Die Stimm-Effekte als Geräte-Seiten: je Effekt Erklärung, Live-Werte, wo
   es welche gibt, und alle Einstellungen als Zeilen. Echo und Hall teilen
   ihre Zeilen mit den Effekt-Bussen des Mischpults. */

export type VoiceDeviceId = Exclude<keyof VoiceParams, "enabled">;
export const VOICE_DEVICES: VoiceDeviceId[] = ["pitch", "autotune", "harmonizer", "vocoder", "character", "modulation", "echo", "reverb"];
export const VOICE_ICONS: Record<VoiceDeviceId, ReactNode> = {
  pitch: <ArrowsDownUp />,
  autotune: <MusicNotes />,
  harmonizer: <UsersThree />,
  vocoder: <Robot />,
  character: <MaskHappy />,
  modulation: <WaveSine />,
  echo: <Repeat />,
  reverb: <Church />,
};

const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;
const percent = (v: number) => `${Math.round(v * 100)} %`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const PERCENT_MARKS: [number, string][] = [
  [0, "0 %"],
  [0.5, "50 %"],
  [1, "100 %"],
];
/** Hz-Wert aus getipptem Text für Regler, die logarithmisch (log2 Hz) laufen. */
const parseLogHz = (text: string) => {
  const value = parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
  return value && value > 0 ? Math.log2(value) : null;
};

/* ---------- Autotune-Klaviatur ---------- */

const SCALES: Scale[] = ["chromatic", "major", "minor", "pentatonic", "blues"];
const BLACK_KEYS = [1, 3, 6, 8, 10];

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
        {!black && <span className={cn("font-mono text-[11px] font-semibold", !inside && !root && "opacity-35")}>{keyName(n)}</span>}
      </button>
    );
  };
  return (
    <div className="relative flex h-24 max-w-xl min-w-0 gap-[3px] rounded-[10px] bg-[oklch(20%_0.006_60)] p-[3px] pt-1.5" title={t("voice.key")}>
      {whites.map((n) => key(n, false))}
      <div className="pointer-events-none absolute inset-x-[3px] top-1.5 bottom-[3px] [&>*]:pointer-events-auto">{BLACK_KEYS.map((n) => key(n, true))}</div>
    </div>
  );
}

/* ---------- Charakter ---------- */

const MODES: { id: CharacterMode; icon: ReactNode }[] = [
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

const CHORDS: Chord[] = ["single", "fifth", "major", "minor"];
const MOD_MODES: ModulationMode[] = ["chorus", "flanger", "phaser"];

/* ---------- Echo und Hall, auch für die Effekt-Busse ---------- */

type EchoValues = { timeMs: number; feedback: number; toneHz: number; mix: number };
type ReverbValues = { size: number; damping: number; predelayMs: number; lowCutHz: number; mix: number };

/** Einstellungszeilen eines Echos. */
export function EchoRows({ params, onChange, mixLabel = t("voice.mix") }: { params: EchoValues; onChange: (patch: Partial<EchoValues>) => void; mixLabel?: string }) {
  return (
    <>
      <ParamRow label={t("voice.time")} hint={t("devices.echo.time")}>
        <Slider
          label={t("voice.time")}
          value={params.timeMs}
          min={20}
          max={1500}
          step={5}
          reset={320}
          format={(v) => `${Math.round(v)} ms`}
          marks={[
            [20, "20 ms"],
            [500, "0,5 s"],
            [1000, "1 s"],
            [1500, "1,5 s"],
          ]}
          onChange={(timeMs) => onChange({ timeMs })}
        />
      </ParamRow>
      <ParamRow label={t("voice.feedback")} hint={t("devices.echo.feedback")}>
        <Slider label={t("voice.feedback")} value={params.feedback} min={0} max={0.95} step={0.01} reset={0.35} format={percent} onChange={(feedback) => onChange({ feedback })} />
      </ParamRow>
      <ParamRow label={t("voice.echoTone")} hint={t("devices.echo.tone")}>
        <Slider
          label={t("voice.echoTone")}
          value={Math.log2(params.toneHz)}
          min={Math.log2(500)}
          max={Math.log2(16000)}
          step={0.01}
          reset={Math.log2(4000)}
          format={(v) => hz(Math.pow(2, v))}
          parse={parseLogHz}
          marks={[
            [Math.log2(500), "500"],
            [Math.log2(2000), "2k"],
            [Math.log2(8000), "8k"],
            [Math.log2(16000), "16k"],
          ]}
          onChange={(v) => onChange({ toneHz: Math.round(Math.pow(2, v)) })}
        />
      </ParamRow>
      <ParamRow label={mixLabel} hint={t("devices.echo.mix")}>
        <Slider label={mixLabel} value={params.mix} min={0} max={1} step={0.01} reset={0.3} format={percent} marks={PERCENT_MARKS} onChange={(mix) => onChange({ mix })} />
      </ParamRow>
    </>
  );
}

/** Einstellungszeilen eines Halls. */
export function ReverbRows({ params, onChange, mixLabel = t("voice.mix") }: { params: ReverbValues; onChange: (patch: Partial<ReverbValues>) => void; mixLabel?: string }) {
  return (
    <>
      <ParamRow label={t("voice.size")} hint={t("devices.reverb.size")}>
        <Slider label={t("voice.size")} value={params.size} min={0} max={1} step={0.01} reset={0.6} format={percent} marks={PERCENT_MARKS} onChange={(size) => onChange({ size })} />
      </ParamRow>
      <ParamRow label={t("voice.damping")} hint={t("devices.reverb.damping")}>
        <Slider label={t("voice.damping")} value={params.damping} min={0} max={1} step={0.01} reset={0.5} format={percent} marks={PERCENT_MARKS} onChange={(damping) => onChange({ damping })} />
      </ParamRow>
      <ParamRow label={t("voice.predelay")} hint={t("devices.reverb.predelay")}>
        <Slider
          label={t("voice.predelay")}
          value={params.predelayMs}
          min={0}
          max={200}
          step={1}
          reset={20}
          format={(v) => `${v} ms`}
          marks={[
            [0, "0"],
            [100, "100 ms"],
            [200, "200 ms"],
          ]}
          onChange={(predelayMs) => onChange({ predelayMs })}
        />
      </ParamRow>
      <ParamRow label={t("voice.lowCut")} hint={t("devices.reverb.lowCut")}>
        <Slider label={t("voice.lowCut")} value={params.lowCutHz} min={20} max={1000} step={10} reset={200} format={hz} onChange={(lowCutHz) => onChange({ lowCutHz })} />
      </ParamRow>
      <ParamRow label={mixLabel} hint={t("devices.reverb.mix")}>
        <Slider label={mixLabel} value={params.mix} min={0} max={1} step={0.01} reset={0.25} format={percent} marks={PERCENT_MARKS} onChange={(mix) => onChange({ mix })} />
      </ParamRow>
    </>
  );
}

/* ---------- Geräte ---------- */

/** Ein Stimm-Effekt als Seite. */
export function VoiceDevice({ id }: { id: VoiceDeviceId }) {
  const voice = useStore((s) => s.effects.voice);
  const meters = useStore((s) => (s.info ? s.meters?.effects : undefined));
  const p = voice[id];
  const set = <K extends VoiceDeviceId>(key: K, patch: Partial<VoiceParams[K]>) => actions.setVoice(key, patch);
  const page = (extra: { live?: ReactNode; columns?: 1 | 2 }, children: ReactNode) => (
    <DevicePage
      icon={VOICE_ICONS[id]}
      title={t(`voice.${id}`)}
      about={t(`devices.${id}.about`)}
      enabled={p.enabled}
      onToggle={(enabled) => set(id, { enabled })}
      onReset={() => actions.setVoice(id, { ...VOICE_DEFAULTS[id], enabled: p.enabled })}
      {...extra}
    >
      {children}
    </DevicePage>
  );
  const sung = meters && meters.pitchHz > 0 ? noteOf(meters.pitchHz) : null;

  switch (id) {
    case "pitch":
      return page(
        { live: <Readout label={t("voice.sung")} value={sung !== null ? noteName(sung) : "—"} sub={sung !== null && voice.pitch.enabled ? `→ ${noteName(sung + voice.pitch.semitones)}` : undefined} /> },
        <>
          <ParamRow label={t("voice.semitones")} hint={t("devices.pitch.semitones")}>
            <div className="flex flex-col gap-2">
              <Slider
                label={t("voice.semitones")}
                value={voice.pitch.semitones}
                min={-12}
                max={12}
                step={1}
                reset={0}
                bipolar
                format={(v) => signed(v)}
                marks={[
                  [-12, "−12"],
                  [-7, "−7"],
                  [0, "0"],
                  [7, "+7"],
                  [12, "+12"],
                ]}
                onChange={(semitones) => set("pitch", { semitones })}
              />
            </div>
          </ParamRow>
          <ParamRow label={t("voice.formant")} hint={t("devices.pitch.formant")}>
            <Slider
              label={t("voice.formant")}
              value={voice.pitch.formant}
              min={-8}
              max={8}
              step={0.5}
              reset={0}
              bipolar
              format={(v) => signed(v, 1)}
              marks={[
                [-8, "−8"],
                [0, "0"],
                [8, "+8"],
              ]}
              onChange={(formant) => set("pitch", { formant })}
            />
          </ParamRow>
        </>,
      );
    case "autotune": {
      const target = meters && meters.targetNote >= 0 ? meters.targetNote : null;
      const cents = meters?.correctionCents ?? 0;
      return page(
        {
          live: (
            <>
              <Readout label={t("voice.sung")} value={sung !== null ? noteName(sung) : "—"} />
              <Readout label={t("voice.target")} value={target !== null && voice.autotune.enabled ? noteName(target) : "—"} sub={target !== null && voice.autotune.enabled ? `${signed(Math.round(cents))} ct` : undefined} />
            </>
          ),
        },
        <>
          <ParamRow label={t("voice.key")} hint={t("devices.autotune.key")}>
            <Keyboard value={voice.autotune.key} scale={voice.autotune.scale} onChange={(key) => set("autotune", { key })} />
          </ParamRow>
          <ParamRow label={t("voice.scaleLabel")} hint={t("devices.autotune.scale")}>
            <PushButtons
              className="max-w-xl"
              value={voice.autotune.scale}
              onChange={(scale: Scale) => set("autotune", { scale })}
              options={SCALES.map((s) => ({ value: s, label: t(`voice.scale.${s}`) }))}
            />
          </ParamRow>
          <ParamRow label={t("voice.speed")} hint={t("devices.autotune.speed")}>
            <Slider
              label={t("voice.speed")}
              value={voice.autotune.speed}
              min={0}
              max={1}
              step={0.01}
              reset={0.3}
              format={(v) => (v < 0.05 ? t("voice.instant") : `${Math.round(v * v * 400)} ms`)}
              marks={[
                [0, t("voice.instant")],
                [0.5, "100 ms"],
                [1, "400 ms"],
              ]}
              onChange={(speed) => set("autotune", { speed })}
            />
          </ParamRow>
        </>,
      );
    }
    case "harmonizer": {
      const setVoice = (index: 0 | 1, patch: Partial<(typeof voice.harmonizer.voices)[0]>) => {
        const voices = [...voice.harmonizer.voices] as typeof voice.harmonizer.voices;
        voices[index] = { ...voices[index], ...patch };
        set("harmonizer", { voices });
      };
      return page(
        { columns: 2 },
        ([0, 1] as const).map((i) => {
          const v = voice.harmonizer.voices[i];
          return (
            <div key={i} className="flex min-w-0 flex-col">
              <ParamRow label={t("voice.voiceN", { n: i + 1 })}>
                <PushButton className="max-w-40" label={v.enabled ? t("common.on") : t("common.off")} on={v.enabled} onChange={(enabled) => setVoice(i, { enabled })} />
              </ParamRow>
              <ParamRow label={t("voice.interval")} hint={t("devices.harmonizer.interval")}>
                <div className="flex flex-col gap-2">
                  <Slider
                    label={t("voice.interval")}
                    value={v.semitones}
                    min={-12}
                    max={12}
                    step={1}
                    reset={0}
                    bipolar
                    disabled={!v.enabled}
                    format={(x) => signed(x)}
                    onChange={(semitones) => setVoice(i, { semitones })}
                  />
                  <QuickPicks
                    options={[
                      { label: t("voice.thirdDown"), value: -3 },
                      { label: t("voice.thirdUp"), value: 4 },
                      { label: t("voice.fifthUp"), value: 7 },
                      { label: t("voice.octaveUp"), value: 12 },
                    ]}
                    isActive={(x) => v.semitones === x}
                    onPick={(semitones) => setVoice(i, { semitones })}
                  />
                </div>
              </ParamRow>
              <ParamRow label={t("voice.level")} hint={t("devices.harmonizer.level")}>
                <Slider label={t("voice.level")} value={v.level} min={0} max={1} step={0.01} reset={0.6} disabled={!v.enabled} format={percent} marks={PERCENT_MARKS} onChange={(level) => setVoice(i, { level })} />
              </ParamRow>
            </div>
          );
        }),
      );
    }
    case "vocoder":
      return page(
        { columns: 2, live: <Readout label={t("voice.note")} value={voice.vocoder.follow ? (sung !== null ? noteName(sung) : "—") : noteName(voice.vocoder.note)} /> },
        <>
          <ParamRow label={t("voice.chord")} hint={t("devices.vocoder.chord")}>
            <PushButtons value={voice.vocoder.chord} onChange={(chord: Chord) => set("vocoder", { chord })} options={CHORDS.map((c) => ({ value: c, label: t(`voice.chord.${c}`) }))} />
          </ParamRow>
          <ParamRow label={t("voice.follow")} hint={t("devices.vocoder.follow")}>
            <PushButton className="max-w-40" label={voice.vocoder.follow ? t("common.on") : t("common.off")} on={voice.vocoder.follow} onChange={(follow) => set("vocoder", { follow })} />
          </ParamRow>
          <ParamRow label={t("voice.note")} hint={t("devices.vocoder.note")}>
            <Slider
              label={t("voice.note")}
              value={voice.vocoder.note}
              min={28}
              max={76}
              step={1}
              reset={48}
              disabled={voice.vocoder.follow}
              format={(v) => noteName(v)}
              parse={() => null}
              marks={[
                [36, noteName(36)],
                [48, noteName(48)],
                [60, noteName(60)],
                [72, noteName(72)],
              ]}
              onChange={(note) => set("vocoder", { note })}
            />
          </ParamRow>
          <ParamRow label={t("voice.breath")} hint={t("devices.vocoder.breath")}>
            <Slider label={t("voice.breath")} value={voice.vocoder.breath} min={0} max={1} step={0.01} reset={0.2} format={percent} marks={PERCENT_MARKS} onChange={(breath) => set("vocoder", { breath })} />
          </ParamRow>
          <ParamRow label={t("voice.mix")} hint={t("devices.vocoder.mix")}>
            <Slider label={t("voice.mix")} value={voice.vocoder.mix} min={0} max={1} step={0.01} reset={1} format={percent} marks={PERCENT_MARKS} onChange={(mix) => set("vocoder", { mix })} />
          </ParamRow>
        </>,
      );
    case "character": {
      const tone = toneOf(voice.character.mode, voice.character.tone);
      return page(
        {},
        <>
          <ParamRow label={t("voice.modeLabel")} hint={t("devices.character.mode")}>
            <div className="grid grid-cols-7 gap-1.5">
              {MODES.map((m) => {
                const on = voice.character.mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set("character", { mode: m.id })}
                    className={cn(
                      "flex h-16 min-w-0 cursor-default flex-col items-center justify-center gap-1.5 rounded-[10px] px-1 text-xs transition-all duration-200 [&_svg]:size-5",
                      on ? "bg-panel-raised font-semibold text-foreground shadow-[inset_0_0_0_2px_var(--ch-mic),0_4px_10px_-6px_oklch(0%_0_0/40%)] [&_svg]:text-[var(--ch-mic)]" : "bg-[var(--meter-track)] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.icon}
                    <span className="w-full truncate text-center">{t(`voice.mode.${m.id}`)}</span>
                  </button>
                );
              })}
            </div>
          </ParamRow>
          <ParamRow label={t("voice.amount")} hint={t("devices.character.amount")}>
            <Slider label={t("voice.amount")} value={voice.character.amount} min={0} max={1} step={0.01} reset={0.5} format={percent} marks={PERCENT_MARKS} onChange={(amount) => set("character", { amount })} />
          </ParamRow>
          <ParamRow label={tone.label}>
            <Slider label={tone.label} value={voice.character.tone} min={0} max={1} step={0.01} reset={0.5} format={() => tone.value} parse={() => null} onChange={(v) => set("character", { tone: v })} />
          </ParamRow>
          <ParamRow label={t("voice.mix")} hint={t("devices.character.mix")}>
            <Slider label={t("voice.mix")} value={voice.character.mix} min={0} max={1} step={0.01} reset={1} format={percent} marks={PERCENT_MARKS} onChange={(mix) => set("character", { mix })} />
          </ParamRow>
        </>,
      );
    }
    case "modulation":
      return page(
        { columns: 2 },
        <>
          <ParamRow label={t("voice.modeLabel")} hint={t("devices.modulation.mode")}>
            <PushButtons value={voice.modulation.mode} onChange={(mode: ModulationMode) => set("modulation", { mode })} options={MOD_MODES.map((m) => ({ value: m, label: t(`voice.mod.${m}`) }))} />
          </ParamRow>
          <ParamRow label={t("voice.rate")} hint={t("devices.modulation.rate")}>
            <Slider label={t("voice.rate")} value={voice.modulation.rateHz} min={0.05} max={8} step={0.05} reset={0.8} format={(v) => `${v.toFixed(2)} Hz`} onChange={(rateHz) => set("modulation", { rateHz })} />
          </ParamRow>
          <ParamRow label={t("voice.depth")} hint={t("devices.modulation.depth")}>
            <Slider label={t("voice.depth")} value={voice.modulation.depth} min={0} max={1} step={0.01} reset={0.5} format={percent} marks={PERCENT_MARKS} onChange={(depth) => set("modulation", { depth })} />
          </ParamRow>
          <ParamRow label={t("voice.feedback")} hint={t("devices.modulation.feedback")}>
            <Slider
              label={t("voice.feedback")}
              value={voice.modulation.feedback}
              min={0}
              max={0.9}
              step={0.01}
              reset={0.3}
              disabled={voice.modulation.mode === "chorus"}
              format={percent}
              onChange={(feedback) => set("modulation", { feedback })}
            />
          </ParamRow>
          <ParamRow label={t("voice.mix")} hint={t("devices.modulation.mix")}>
            <Slider label={t("voice.mix")} value={voice.modulation.mix} min={0} max={1} step={0.01} reset={0.5} format={percent} marks={PERCENT_MARKS} onChange={(mix) => set("modulation", { mix })} />
          </ParamRow>
        </>,
      );
    case "echo":
      return page({ columns: 2 }, <EchoRows params={voice.echo} onChange={(patch) => set("echo", patch)} />);
    case "reverb":
      return page({ columns: 2 }, <ReverbRows params={voice.reverb} onChange={(patch) => set("reverb", patch)} />);
  }
}
