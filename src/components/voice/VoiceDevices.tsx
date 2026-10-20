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
import { createContext, useContext, type ReactNode } from "react";
import { Klavier, type CustomLabelProps } from "klavier";
import { realistic } from "klavier/presets/realistic";
import "klavier/presets/realistic.css";
import { DevicePage, KnobDeck, ParamRow, QuickPicks, Readout, Slider } from "~/components/effects/device";
import { PushButton, PushButtons } from "~/components/ui/hardware";
import { parseNumber } from "~/components/ui/knob";
import { VOICE_DEFAULTS } from "~/lib/defaults";
import type { CharacterMode, Chord, ModulationMode, Scale, VoiceParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { inScale, keyName, noteName, noteOf } from "./icons";
import { DecayChart, IntervalChart, LfoChart, PitchPad, PitchTrack, TapsChart, WaveChart } from "./VoiceCharts";

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
const parseHz = (text: string) => parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");

/* ---------- Autotune-Klaviatur ---------- */

const SCALES: Scale[] = ["chromatic", "major", "minor", "pentatonic", "blues"];

/** Grundton und Tonleiter für die Beschriftung der Tasten. */
const ScaleContext = createContext<{ root: number; scale: Scale }>({ root: 0, scale: "chromatic" });

/** Beschriftung auf den Tasten (klavier): Grundton als Marke in Mikrofon-Farbe,
    Töne der Tonleiter mit Punkt und Namen, alle anderen ohne. */
function KeyLabel({ note }: CustomLabelProps) {
  const { root, scale } = useContext(ScaleContext);
  const n = note.midiNumber % 12;
  const white = note.keyColor === "white";
  const inside = inScale(n, root, scale);
  if (!white && !inside && n !== root) return null;
  return (
    // Liegt über der Tasten-Grafik, die klavier absolut positioniert.
    <span className={cn("pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1", white ? "bottom-2" : "bottom-1.5")}>
      {n === root ? (
        <span className="grid size-5 place-items-center rounded-full bg-[var(--ch-mic)] font-mono text-[10px] font-bold text-white shadow-[0_1px_2px_oklch(0%_0_0/40%)]">
          {keyName(n)}
        </span>
      ) : (
        <>
          {inside && <span className={cn("size-1.5 rounded-full", white ? "bg-[var(--ch-mic)]" : "bg-white/80")} />}
          {white && (
            <span className={cn("font-mono text-[10px] font-semibold text-[oklch(32%_0.01_60)]", !inside && "opacity-40")}>{keyName(n)}</span>
          )}
        </>
      )}
    </span>
  );
}

/** Grundton als Klaviatur über eine Oktave (klavier, realistische Tasten);
    ein Klick wählt den Grundton. */
function Keyboard({ value, scale, onChange }: { value: number; scale: Scale; onChange: (key: number) => void }) {
  return (
    <ScaleContext.Provider value={{ root: value, scale }}>
      <div className="max-w-md overflow-hidden rounded-md bg-[oklch(14%_0.004_60)] px-1 pt-2 pb-1 shadow-[inset_0_1px_0_oklch(100%_0_0/8%)]" title={t("voice.key")}>
        <Klavier
          keyRange={[60, 71]}
          activeKeys={[60 + value]}
          onKeyPress={(midi) => onChange(midi % 12)}
          interactive={{ keyboard: false, mouse: true, touch: true }}
          height="96px"
          components={{ ...realistic, label: KeyLabel }}
        />
      </div>
    </ScaleContext.Provider>
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
export function EchoRows({
  params,
  onChange,
  mixLabel = t("voice.mix"),
}: {
  params: EchoValues;
  onChange: (patch: Partial<EchoValues>) => void;
  mixLabel?: string;
}) {
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
      <KnobDeck
        knobs={[
          {
            label: t("voice.feedback"),
            hint: t("devices.echo.feedback"),
            value: params.feedback,
            min: 0,
            max: 0.95,
            step: 0.01,
            reset: 0.35,
            format: percent,
            onChange: (feedback) => onChange({ feedback }),
          },
          {
            label: t("voice.echoTone"),
            hint: t("devices.echo.tone"),
            value: params.toneHz,
            min: 500,
            max: 16000,
            step: 1,
            log: true,
            reset: 4000,
            format: hz,
            parse: parseHz,
            onChange: (toneHz) => onChange({ toneHz }),
          },
          {
            label: mixLabel,
            hint: t("devices.echo.mix"),
            value: params.mix,
            min: 0,
            max: 1,
            step: 0.01,
            reset: 0.3,
            format: percent,
            onChange: (mix) => onChange({ mix }),
          },
        ]}
      />
    </>
  );
}

/** Einstellungszeilen eines Halls. */
export function ReverbRows({
  params,
  onChange,
  mixLabel = t("voice.mix"),
}: {
  params: ReverbValues;
  onChange: (patch: Partial<ReverbValues>) => void;
  mixLabel?: string;
}) {
  return (
    <>
      <ParamRow label={t("voice.size")} hint={t("devices.reverb.size")}>
        <Slider
          label={t("voice.size")}
          value={params.size}
          min={0}
          max={1}
          step={0.01}
          reset={0.6}
          format={percent}
          marks={PERCENT_MARKS}
          onChange={(size) => onChange({ size })}
        />
      </ParamRow>
      <KnobDeck
        knobs={[
          {
            label: t("voice.damping"),
            hint: t("devices.reverb.damping"),
            value: params.damping,
            min: 0,
            max: 1,
            step: 0.01,
            reset: 0.5,
            format: percent,
            onChange: (damping) => onChange({ damping }),
          },
          {
            label: t("voice.predelay"),
            hint: t("devices.reverb.predelay"),
            value: params.predelayMs,
            min: 0,
            max: 200,
            step: 1,
            reset: 20,
            format: (v) => `${v} ms`,
            onChange: (predelayMs) => onChange({ predelayMs }),
          },
          {
            label: t("voice.lowCut"),
            hint: t("devices.reverb.lowCut"),
            value: params.lowCutHz,
            min: 20,
            max: 1000,
            step: 1,
            log: true,
            reset: 200,
            format: hz,
            parse: parseHz,
            onChange: (lowCutHz) => onChange({ lowCutHz }),
          },
          {
            label: mixLabel,
            hint: t("devices.reverb.mix"),
            value: params.mix,
            min: 0,
            max: 1,
            step: 0.01,
            reset: 0.25,
            format: percent,
            onChange: (mix) => onChange({ mix }),
          },
        ]}
      />
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
  const page = (extra: { live?: ReactNode; columns?: 1 | 2; graph?: ReactNode }, children: ReactNode) => (
    <DevicePage
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
        {
          live: (
            <Readout
              label={t("voice.sung")}
              value={sung !== null ? noteName(sung) : "—"}
              sub={sung !== null && voice.pitch.enabled ? `→ ${noteName(sung + voice.pitch.semitones)}` : undefined}
            />
          ),
          graph: (
            <PitchPad semitones={voice.pitch.semitones} formant={voice.pitch.formant} onChange={(semitones, formant) => set("pitch", { semitones, formant })} />
          ),
        },
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
          <KnobDeck
            knobs={[
              {
                label: t("voice.formant"),
                hint: t("devices.pitch.formant"),
                value: voice.pitch.formant,
                min: -8,
                max: 8,
                step: 0.5,
                reset: 0,
                bipolar: true,
                format: (v) => signed(v, 1),
                onChange: (formant) => set("pitch", { formant }),
              },
            ]}
          />
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
              <Readout
                label={t("voice.target")}
                value={target !== null && voice.autotune.enabled ? noteName(target) : "—"}
                sub={target !== null && voice.autotune.enabled ? `${signed(Math.round(cents))} ct` : undefined}
              />
            </>
          ),
          graph: <PitchTrack keyNote={voice.autotune.key} scale={voice.autotune.scale} />,
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
        { columns: 2, graph: <IntervalChart voices={voice.harmonizer.voices} onChange={(i, patch) => setVoice(i, patch)} /> },
        ([0, 1] as const).map((i) => {
          const v = voice.harmonizer.voices[i];
          return (
            <div key={i} className="flex min-w-0 flex-col">
              <ParamRow label={t("voice.voiceN", { n: i + 1 })}>
                <PushButton
                  className="max-w-40"
                  label={v.enabled ? t("common.on") : t("common.off")}
                  on={v.enabled}
                  onChange={(enabled) => setVoice(i, { enabled })}
                />
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
              <KnobDeck
                knobs={[
                  {
                    label: t("voice.level"),
                    hint: t("devices.harmonizer.level"),
                    value: v.level,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    reset: 0.6,
                    disabled: !v.enabled,
                    format: percent,
                    onChange: (level) => setVoice(i, { level }),
                  },
                ]}
              />
            </div>
          );
        }),
      );
    }
    case "vocoder":
      return page(
        {
          columns: 2,
          live: <Readout label={t("voice.note")} value={voice.vocoder.follow ? (sung !== null ? noteName(sung) : "—") : noteName(voice.vocoder.note)} />,
        },
        <>
          <ParamRow label={t("voice.chord")} hint={t("devices.vocoder.chord")}>
            <PushButtons
              value={voice.vocoder.chord}
              onChange={(chord: Chord) => set("vocoder", { chord })}
              options={CHORDS.map((c) => ({ value: c, label: t(`voice.chord.${c}`) }))}
            />
          </ParamRow>
          <ParamRow label={t("voice.follow")} hint={t("devices.vocoder.follow")}>
            <PushButton
              className="max-w-40"
              label={voice.vocoder.follow ? t("common.on") : t("common.off")}
              on={voice.vocoder.follow}
              onChange={(follow) => set("vocoder", { follow })}
            />
          </ParamRow>
          <ParamRow wide label={t("voice.note")} hint={t("devices.vocoder.note")}>
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
          <KnobDeck
            knobs={[
              {
                label: t("voice.breath"),
                hint: t("devices.vocoder.breath"),
                value: voice.vocoder.breath,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 0.2,
                format: percent,
                onChange: (breath) => set("vocoder", { breath }),
              },
              {
                label: t("voice.mix"),
                hint: t("devices.vocoder.mix"),
                value: voice.vocoder.mix,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 1,
                format: percent,
                onChange: (mix) => set("vocoder", { mix }),
              },
            ]}
          />
        </>,
      );
    case "character": {
      const tone = toneOf(voice.character.mode, voice.character.tone);
      return page(
        { graph: <WaveChart params={voice.character} /> },
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
                      on
                        ? "bg-panel-raised font-semibold text-foreground shadow-[inset_0_0_0_2px_var(--ch-mic),0_4px_10px_-6px_oklch(0%_0_0/40%)] [&_svg]:text-[var(--ch-mic)]"
                        : "bg-[var(--meter-track)] text-muted-foreground hover:text-foreground",
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
            <Slider
              label={t("voice.amount")}
              value={voice.character.amount}
              min={0}
              max={1}
              step={0.01}
              reset={0.5}
              format={percent}
              marks={PERCENT_MARKS}
              onChange={(amount) => set("character", { amount })}
            />
          </ParamRow>
          <KnobDeck
            knobs={[
              {
                label: tone.label,
                value: voice.character.tone,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 0.5,
                format: () => tone.value,
                parse: () => null,
                onChange: (v) => set("character", { tone: v }),
              },
              {
                label: t("voice.mix"),
                hint: t("devices.character.mix"),
                value: voice.character.mix,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 1,
                format: percent,
                onChange: (mix) => set("character", { mix }),
              },
            ]}
          />
        </>,
      );
    }
    case "modulation":
      return page(
        {
          graph: <LfoChart rate={voice.modulation.rateHz} depth={voice.modulation.depth} onChange={(rateHz, depth) => set("modulation", { rateHz, depth })} />,
        },
        <>
          <ParamRow label={t("voice.modeLabel")} hint={t("devices.modulation.mode")}>
            <PushButtons
              value={voice.modulation.mode}
              onChange={(mode: ModulationMode) => set("modulation", { mode })}
              options={MOD_MODES.map((m) => ({ value: m, label: t(`voice.mod.${m}`) }))}
            />
          </ParamRow>
          <KnobDeck
            knobs={[
              {
                label: t("voice.rate"),
                hint: t("devices.modulation.rate"),
                value: voice.modulation.rateHz,
                min: 0.05,
                max: 8,
                step: 0.01,
                log: true,
                reset: 0.8,
                format: (v) => `${v.toFixed(2)} Hz`,
                onChange: (rateHz) => set("modulation", { rateHz }),
              },
              {
                label: t("voice.depth"),
                hint: t("devices.modulation.depth"),
                value: voice.modulation.depth,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 0.5,
                format: percent,
                onChange: (depth) => set("modulation", { depth }),
              },
              {
                label: t("voice.feedback"),
                hint: t("devices.modulation.feedback"),
                value: voice.modulation.feedback,
                min: 0,
                max: 0.9,
                step: 0.01,
                reset: 0.3,
                disabled: voice.modulation.mode === "chorus",
                format: percent,
                onChange: (feedback) => set("modulation", { feedback }),
              },
              {
                label: t("voice.mix"),
                hint: t("devices.modulation.mix"),
                value: voice.modulation.mix,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 0.5,
                format: percent,
                onChange: (mix) => set("modulation", { mix }),
              },
            ]}
          />
        </>,
      );
    case "echo":
      return page(
        { graph: <TapsChart params={voice.echo} onChange={(patch) => set("echo", patch)} /> },
        <EchoRows params={voice.echo} onChange={(patch) => set("echo", patch)} />,
      );
    case "reverb":
      return page(
        { graph: <DecayChart params={voice.reverb} onChange={(patch) => set("reverb", patch)} /> },
        <ReverbRows params={voice.reverb} onChange={(patch) => set("reverb", patch)} />,
      );
  }
}
