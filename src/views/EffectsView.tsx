import { ArrowLineUp, ArrowsInLineVertical, Broom, Door, Equalizer, Gauge, Plug, SpeakerSimpleSlash, Sun, Waves } from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";
import { HistoryChart, SpectrumChart, useHistory } from "~/components/effects/charts";
import { EqControls, EqGraph, useEqTarget } from "~/components/effects/EqEditor";
import { Crossfade, DeviceBar, DevicePage, KnobDeck, Lamp, Meter, ParamRow, Readout, Slider, useSelected } from "~/components/effects/device";
import { PluginsPanel } from "~/components/effects/PluginsPanel";
import { PushButtons } from "~/components/ui/hardware";
import { EFFECTS_DEFAULTS } from "~/lib/defaults";
import type { EffectsParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { plugins, usePlugins } from "~/lib/plugins";
import { actions, useStore } from "~/lib/store";
import { formatDb, gainToDb } from "~/lib/utils";

/* Die Aufbereitung des Mikrofons: oben alle Geräte der Kette zum
   Durchschalten, darunter das gewählte mit Erklärung, Live-Werten und seinen
   Einstellungen. */

type DeviceId = Exclude<keyof EffectsParams, "voice">;

const db = (v: number) => `${formatDb(v)} dB`;
const kHz = (v: number) => `${(v / 1000).toFixed(1)} kHz`;
const percent = (v: number) => `${Math.round(v * 100)} %`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DEVICES: DeviceId[] = ["aec", "gate", "denoise", "eq", "agc", "compressor", "deEsser", "exciter", "limiter"];
const ICONS: Record<DeviceId | "plugin", ReactNode> = {
  aec: <SpeakerSimpleSlash />,
  gate: <Door />,
  denoise: <Broom />,
  eq: <Equalizer />,
  agc: <Gauge />,
  compressor: <ArrowsInLineVertical />,
  deEsser: <Waves />,
  exciter: <Sun />,
  limiter: <ArrowLineUp />,
  plugin: <Plug />,
};

const RATIOS = [
  { value: 2, label: "effects.ratioSoft" },
  { value: 4, label: "effects.ratioMedium" },
  { value: 8, label: "effects.ratioHard" },
];

const LEVEL_FLOOR = -70;
const levelPos = (v: number) => clamp01((v - LEVEL_FLOOR) / -LEVEL_FLOOR);
const LEVEL_SCALE: [number, string][] = [-60, -40, -20, 0].map((v) => [levelPos(v), String(v)]);

/** Mikrofonpegel in dB, solange die Engine läuft. */
function useMicDb() {
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0) : 0));
  return gainToDb(peak, LEVEL_FLOOR);
}

/** Mikrofonpegel als Balken, optional mit einer Marke (Schwelle, Ziel, Obergrenze). */
function MicMeter({ marker }: { marker?: number }) {
  const level = useMicDb();
  return <Meter label={t("devices.level")} value={levelPos(level)} marker={marker} text={level <= LEVEL_FLOOR ? "—" : db(level)} scale={LEVEL_SCALE} />;
}

function ReductionMeter({ db: value, max }: { db: number; max: number }) {
  return <Meter label={t("devices.reduction")} value={-value / max} text={value < -0.05 ? `${value.toFixed(1)} dB` : "0 dB"} tone="warning" />;
}

function Device({ id }: { id: DeviceId }) {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => (s.info ? s.meters?.effects : undefined));
  const p = fx[id];
  const set = <K extends DeviceId>(key: K, patch: Partial<EffectsParams[K]>) => actions.setEffect(key, patch);
  // Verläufe für die Diagramme; welche gebraucht werden, hängt vom Gerät ab.
  const levels = useHistory(useMicDb(), 8, -90);
  const [eqTarget, setEqTarget] = useEqTarget();
  const reductionNow =
    id === "compressor" ? live?.compressorDb : id === "deEsser" ? live?.deEsserDb : id === "limiter" ? live?.limiterDb : id === "agc" ? live?.agcGainDb : 0;
  const reductions = useHistory(p.enabled ? (reductionNow ?? 0) : 0, 8, 0);
  const voices = useHistory(fx.denoise.enabled ? (live?.voice ?? 0) * 100 : 0, 8, 0);
  const erles = useHistory(fx.aec.enabled ? (live?.echoErleDb ?? 0) : 0, 8, 0);
  const echoReference = useStore((s) => s.info?.echoReference);
  const history = (range: [number, number], line?: { value: number; label: string; min: number; max: number; onChange: (v: number) => void }, gr?: number) => (
    <HistoryChart
      range={range}
      grMax={gr}
      line={line}
      series={[{ values: levels, tone: "muted" }, ...(gr ? [{ values: reductions, tone: "warning" as const, scale: "gr" as const }] : [])]}
    />
  );
  const page = (extra: { live?: ReactNode; columns?: 1 | 2; graph?: ReactNode }, children: ReactNode) => (
    <DevicePage
      title={t(`effects.${id}`)}
      about={t(`devices.${id}.about`)}
      enabled={p.enabled}
      onToggle={(enabled) => set(id, { enabled })}
      onReset={() => actions.setEffect(id, { ...EFFECTS_DEFAULTS[id], enabled: p.enabled })}
      {...extra}
    >
      {children}
    </DevicePage>
  );

  switch (id) {
    case "aec": {
      const speaker = fx.aec.enabled ? (live?.echoReference ?? 0) : 0;
      const erle = fx.aec.enabled ? (live?.echoErleDb ?? 0) : 0;
      const delay = fx.aec.enabled ? (live?.echoDelayMs ?? 0) : 0;
      return page(
        {
          live: (
            <>
              <Meter label={t("devices.aec.speaker")} value={levelPos(gainToDb(speaker, LEVEL_FLOOR))} text={speaker > 0.001 ? db(gainToDb(speaker, LEVEL_FLOOR)) : "—"} scale={LEVEL_SCALE} />
              <Meter label={t("devices.aec.removed")} value={erle / 40} tone="success" text={erle > 0.05 ? `${erle.toFixed(1)} dB` : "0 dB"} />
            </>
          ),
          graph: <HistoryChart range={[0, 40]} series={[{ values: erles, tone: "accent" }]} />,
        },
        <>
          <ParamRow label={t("devices.aec.reference")} hint={t("devices.aec.referenceHint")}>
            <span className={echoReference ? "text-sm" : "text-sm text-muted-foreground"}>{echoReference?.deviceName ?? t("devices.aec.noReference")}</span>
          </ParamRow>
          <ParamRow label={t("devices.aec.delay")} hint={t("devices.aec.delayHint")}>
            <Readout label="" value={delay > 0 ? `${Math.round(delay)} ms` : "—"} sub={fx.aec.enabled && delay <= 0 ? t("devices.aec.learning") : undefined} />
          </ParamRow>
        </>,
      );
    }
    case "gate":
      return page(
        {
          live: (
            <>
              <MicMeter marker={levelPos(fx.gate.thresholdDb)} />
              <Lamp on={!!live?.gateOpen && fx.gate.enabled} label={t("devices.open")} />
            </>
          ),
          graph: history([-80, 0], {
            value: fx.gate.thresholdDb,
            label: `${t("effects.threshold")} ${db(fx.gate.thresholdDb)}`,
            min: -70,
            max: -10,
            onChange: (thresholdDb) => set("gate", { thresholdDb }),
          }),
        },
        <ParamRow label={t("effects.threshold")} hint={t("devices.gate.threshold")}>
          <Slider
            label={t("effects.threshold")}
            value={fx.gate.thresholdDb}
            min={-70}
            max={-10}
            step={1}
            reset={-50}
            format={db}
            marks={[
              [-70, "−70"],
              [-50, "−50"],
              [-30, "−30"],
              [-10, "−10"],
            ]}
            onChange={(thresholdDb) => set("gate", { thresholdDb })}
          />
        </ParamRow>,
      );
    case "denoise": {
      const voice = fx.denoise.enabled ? (live?.voice ?? 0) : 0;
      return page(
        {
          live: (
            <>
              <Meter label={t("effects.voice")} value={voice} tone="success" text={percent(voice)} />
              <Lamp on={voice > 0.6} label={t("devices.speech")} />
            </>
          ),
          graph: <HistoryChart range={[0, 100]} series={[{ values: voices, tone: "accent" }]} />,
        },
        <>
          <ParamRow label={t("effects.amount")} hint={t("devices.denoise.strength")}>
            <Slider
              label={t("effects.amount")}
              value={fx.denoise.strength}
              min={0}
              max={1}
              step={0.01}
              reset={1}
              format={percent}
              marks={[
                [0, "0 %"],
                [0.5, "50 %"],
                [1, "100 %"],
              ]}
              onChange={(strength) => set("denoise", { strength })}
            />
          </ParamRow>
          <ParamRow label={t("effects.voiceGateLabel")} hint={t("devices.denoise.mode")}>
            <PushButtons
              className="max-w-sm"
              value={fx.denoise.voiceGate ? "voice" : "all"}
              onChange={(v) => set("denoise", { voiceGate: v === "voice" })}
              options={[
                { value: "all", label: t("effects.letAll") },
                { value: "voice", label: t("effects.voiceOnly") },
              ]}
            />
          </ParamRow>
        </>,
      );
    }
    case "eq":
      return page(
        {
          graph: (
            <EqGraph
              eq={fx.eq}
              selected={eqTarget}
              onSelect={setEqTarget}
              spectrumIn={live?.spectrumIn}
              spectrumOut={live?.spectrumOut}
              onChange={(patch) => set("eq", patch)}
            />
          ),
        },
        <EqControls eq={fx.eq} selected={eqTarget} onSelect={setEqTarget} onChange={(patch) => set("eq", patch)} />,
      );
    case "agc": {
      const gain = fx.agc.enabled ? (live?.agcGainDb ?? 0) : 0;
      const range = Math.max(6, fx.agc.maxGainDb);
      return page(
        {
          live: (
            <>
              <MicMeter marker={levelPos(fx.agc.targetDb)} />
              <Meter label={t("devices.gain")} value={0.5 + gain / range / 2} from={0.5} text={db(gain)} />
            </>
          ),
          graph: history([-60, 0], {
            value: fx.agc.targetDb,
            label: `${t("effects.target")} ${db(fx.agc.targetDb)}`,
            min: -30,
            max: -10,
            onChange: (targetDb) => set("agc", { targetDb }),
          }),
        },
        <>
          <KnobDeck
            knobs={[
              {
                label: t("effects.target"),
                hint: t("devices.agc.target"),
                value: fx.agc.targetDb,
                min: -30,
                max: -10,
                step: 1,
                reset: -20,
                format: db,
                onChange: (targetDb) => set("agc", { targetDb }),
              },
              {
                label: t("effects.maxGain"),
                hint: t("devices.agc.maxGain"),
                value: fx.agc.maxGainDb,
                min: 0,
                max: 30,
                step: 1,
                reset: 18,
                format: (v) => `+${v} dB`,
                onChange: (maxGainDb) => set("agc", { maxGainDb }),
              },
            ]}
          />
        </>,
      );
    }
    case "compressor":
      return page(
        {
          live: (
            <>
              <MicMeter marker={levelPos(fx.compressor.thresholdDb)} />
              <ReductionMeter db={fx.compressor.enabled ? (live?.compressorDb ?? 0) : 0} max={18} />
            </>
          ),
          graph: history(
            [-60, 0],
            {
              value: fx.compressor.thresholdDb,
              label: `${t("effects.threshold")} ${db(fx.compressor.thresholdDb)}`,
              min: -50,
              max: 0,
              onChange: (thresholdDb) => set("compressor", { thresholdDb }),
            },
            18,
          ),
        },
        <>
          <ParamRow label={t("effects.ratio")} hint={t("devices.compressor.ratio")}>
            <PushButtons
              className="max-w-sm"
              value={RATIOS.reduce((best, r) => (Math.abs(r.value - fx.compressor.ratio) < Math.abs(best - fx.compressor.ratio) ? r.value : best), 4)}
              options={RATIOS.map((r) => ({ value: r.value, label: t(r.label), title: `${r.value}:1` }))}
              onChange={(ratio) => set("compressor", { ratio })}
            />
          </ParamRow>
          <ParamRow label={t("effects.threshold")} hint={t("devices.compressor.threshold")}>
            <Slider
              label={t("effects.threshold")}
              value={fx.compressor.thresholdDb}
              min={-50}
              max={0}
              step={1}
              reset={-20}
              format={db}
              marks={[
                [-50, "−50"],
                [-30, "−30"],
                [-10, "−10"],
                [0, "0"],
              ]}
              onChange={(thresholdDb) => set("compressor", { thresholdDb })}
            />
          </ParamRow>
          <KnobDeck
            knobs={[
              {
                label: t("effects.makeup"),
                hint: t("devices.compressor.makeup"),
                value: fx.compressor.makeupDb,
                min: 0,
                max: 18,
                step: 0.5,
                reset: 4,
                format: (v) => `+${v.toFixed(1)} dB`,
                onChange: (makeupDb) => set("compressor", { makeupDb }),
              },
            ]}
          />
        </>,
      );
    case "deEsser":
      return page(
        {
          live: <ReductionMeter db={fx.deEsser.enabled ? (live?.deEsserDb ?? 0) : 0} max={18} />,
          graph: (
            <SpectrumChart
              spectrum={live?.spectrumOut}
              markerHz={fx.deEsser.frequencyHz}
              markerLabel={`${t("effects.frequency")} ${kHz(fx.deEsser.frequencyHz)}`}
              range={[3000, 10000]}
              onMarker={(frequencyHz) => set("deEsser", { frequencyHz })}
            />
          ),
        },
        <>
          <ParamRow label={t("effects.threshold")} hint={t("devices.deEsser.threshold")}>
            <Slider
              label={t("effects.threshold")}
              value={fx.deEsser.thresholdDb}
              min={-60}
              max={0}
              step={1}
              reset={-30}
              format={db}
              marks={[
                [-60, "−60"],
                [-40, "−40"],
                [-20, "−20"],
                [0, "0"],
              ]}
              onChange={(thresholdDb) => set("deEsser", { thresholdDb })}
            />
          </ParamRow>
          <KnobDeck
            knobs={[
              {
                label: t("effects.frequency"),
                hint: t("devices.deEsser.frequency"),
                value: fx.deEsser.frequencyHz,
                min: 3000,
                max: 10000,
                step: 100,
                reset: 6000,
                format: kHz,
                onChange: (frequencyHz) => set("deEsser", { frequencyHz }),
              },
            ]}
          />
        </>,
      );
    case "exciter":
      return page(
        {
          graph: (
            <SpectrumChart
              spectrum={live?.spectrumOut}
              markerHz={fx.exciter.frequencyHz}
              markerLabel={`${t("effects.frequency")} ${kHz(fx.exciter.frequencyHz)}`}
              range={[1000, 8000]}
              onMarker={(frequencyHz) => set("exciter", { frequencyHz })}
            />
          ),
        },
        <>
          <KnobDeck
            knobs={[
              {
                label: t("effects.frequency"),
                hint: t("devices.exciter.frequency"),
                value: fx.exciter.frequencyHz,
                min: 1000,
                max: 8000,
                step: 100,
                reset: 3000,
                format: kHz,
                onChange: (frequencyHz) => set("exciter", { frequencyHz }),
              },
              {
                label: t("effects.amount"),
                hint: t("devices.exciter.amount"),
                value: fx.exciter.amount,
                min: 0,
                max: 1,
                step: 0.01,
                reset: 0.3,
                format: percent,
                onChange: (amount) => set("exciter", { amount }),
              },
            ]}
          />
        </>,
      );
    case "limiter":
      return page(
        {
          live: (
            <>
              <MicMeter marker={levelPos(fx.limiter.ceilingDb)} />
              <ReductionMeter db={fx.limiter.enabled ? (live?.limiterDb ?? 0) : 0} max={12} />
            </>
          ),
          graph: history(
            [-40, 0],
            {
              value: fx.limiter.ceilingDb,
              label: `${t("effects.ceiling")} ${db(fx.limiter.ceilingDb)}`,
              min: -20,
              max: 0,
              onChange: (ceilingDb) => set("limiter", { ceilingDb }),
            },
            12,
          ),
        },
        <ParamRow label={t("effects.ceiling")} hint={t("devices.limiter.ceiling")}>
          <Slider
            label={t("effects.ceiling")}
            value={fx.limiter.ceilingDb}
            min={-20}
            max={0}
            step={0.5}
            reset={-3}
            format={db}
            marks={[
              [-20, "−20"],
              [-12, "−12"],
              [-6, "−6"],
              [0, "0"],
            ]}
            onChange={(ceilingDb) => set("limiter", { ceilingDb })}
          />
        </ParamRow>,
      );
  }
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const plugin = usePlugins((s) => s.status);
  const ids: (DeviceId | "plugin")[] = [...DEVICES, ...(plugin.available ? (["plugin"] as const) : [])];
  const [open, select] = useSelected<DeviceId | "plugin">("ode.effects-device", ids, "gate");
  useEffect(() => {
    void plugins.refresh();
  }, []);
  const key = (id: DeviceId) => ({ id, title: t(`effects.${id}`), icon: ICONS[id], enabled: fx[id].enabled });

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <DeviceBar
        value={open}
        onChange={select}
        groups={[
          (["aec", "gate", "denoise", "eq", "agc"] as const).map(key),
          (["compressor", "deEsser", "exciter", "limiter"] as const).map(key),
          ...(plugin.available
            ? [[{ id: "plugin", title: plugin.loaded?.name ?? t("plugins.page"), icon: ICONS.plugin, enabled: !!plugin.loaded && !plugin.bypass }]]
            : []),
        ]}
      />
      <Crossfade id={open} order={ids}>
        {open === "plugin" ? <PluginsPanel embedded /> : <Device id={open} />}
      </Crossfade>
    </div>
  );
}
