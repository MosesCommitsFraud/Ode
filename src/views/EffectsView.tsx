import { ArrowLineUp, ArrowsInLineVertical, Broom, Door, Equalizer, Gauge, Plug, Sun, Waves } from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";
import { Crossfade, DeviceBar, DevicePage, Lamp, Meter, ParamRow, QuickPicks, Slider, useSelected } from "~/components/effects/device";
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

const DEVICES: DeviceId[] = ["gate", "denoise", "eq", "agc", "compressor", "deEsser", "exciter", "limiter"];
const ICONS: Record<DeviceId | "plugin", ReactNode> = {
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

const EQ_PICKS: { label: string; value: [number, number, number] }[] = [
  { label: "devices.eq.neutral", value: [0, 0, 0] },
  { label: "devices.eq.warm", value: [3, -1, -2] },
  { label: "devices.eq.clear", value: [-2, 3, 2] },
  { label: "devices.eq.bright", value: [0, 1, 4] },
  { label: "devices.eq.thin", value: [-5, 0, 0] },
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
  const page = (extra: { live?: ReactNode; columns?: 1 | 2 }, children: ReactNode) => (
    <DevicePage
      icon={ICONS[id]}
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
    case "gate":
      return page(
        {
          live: (
            <>
              <MicMeter marker={levelPos(fx.gate.thresholdDb)} />
              <Lamp on={!!live?.gateOpen && fx.gate.enabled} label={t("devices.open")} />
            </>
          ),
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
        {},
        <>
          <ParamRow label={t("devices.quick")}>
            <QuickPicks
              options={EQ_PICKS.map((o) => ({ label: t(o.label), value: o.value }))}
              isActive={([l, m, h]) => fx.eq.lowDb === l && fx.eq.midDb === m && fx.eq.highDb === h}
              onPick={([lowDb, midDb, highDb]) => set("eq", { lowDb, midDb, highDb })}
            />
          </ParamRow>
          {(
            [
              ["lowDb", "effects.bass", "devices.eq.low"],
              ["midDb", "effects.presence", "devices.eq.mid"],
              ["highDb", "effects.treble", "devices.eq.high"],
            ] as const
          ).map(([key, label, hint]) => (
            <ParamRow key={key} label={t(label)} hint={t(hint)}>
              <Slider
                label={t(label)}
                value={fx.eq[key]}
                min={-12}
                max={12}
                step={0.5}
                reset={0}
                bipolar
                format={db}
                marks={[
                  [-12, "−12"],
                  [-6, "−6"],
                  [0, "0"],
                  [6, "+6"],
                  [12, "+12"],
                ]}
                onChange={(v) => set("eq", { [key]: v })}
              />
            </ParamRow>
          ))}
        </>,
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
        },
        <>
          <ParamRow label={t("effects.target")} hint={t("devices.agc.target")}>
            <Slider
              label={t("effects.target")}
              value={fx.agc.targetDb}
              min={-30}
              max={-10}
              step={1}
              reset={-20}
              format={db}
              marks={[
                [-30, "−30"],
                [-20, "−20"],
                [-10, "−10"],
              ]}
              onChange={(targetDb) => set("agc", { targetDb })}
            />
          </ParamRow>
          <ParamRow label={t("effects.maxGain")} hint={t("devices.agc.maxGain")}>
            <Slider
              label={t("effects.maxGain")}
              value={fx.agc.maxGainDb}
              min={0}
              max={30}
              step={1}
              reset={18}
              format={(v) => `+${v} dB`}
              marks={[
                [0, "0"],
                [10, "+10"],
                [20, "+20"],
                [30, "+30"],
              ]}
              onChange={(maxGainDb) => set("agc", { maxGainDb })}
            />
          </ParamRow>
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
          <ParamRow label={t("effects.makeup")} hint={t("devices.compressor.makeup")}>
            <Slider
              label={t("effects.makeup")}
              value={fx.compressor.makeupDb}
              min={0}
              max={18}
              step={0.5}
              reset={4}
              format={(v) => `+${v.toFixed(1)} dB`}
              marks={[
                [0, "0"],
                [6, "+6"],
                [12, "+12"],
                [18, "+18"],
              ]}
              onChange={(makeupDb) => set("compressor", { makeupDb })}
            />
          </ParamRow>
        </>,
      );
    case "deEsser":
      return page(
        { live: <ReductionMeter db={fx.deEsser.enabled ? (live?.deEsserDb ?? 0) : 0} max={18} /> },
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
          <ParamRow label={t("effects.frequency")} hint={t("devices.deEsser.frequency")}>
            <Slider
              label={t("effects.frequency")}
              value={fx.deEsser.frequencyHz}
              min={3000}
              max={10000}
              step={100}
              reset={6000}
              format={kHz}
              marks={[
                [3000, "3 kHz"],
                [5000, "5"],
                [7000, "7"],
                [10000, "10 kHz"],
              ]}
              onChange={(frequencyHz) => set("deEsser", { frequencyHz })}
            />
          </ParamRow>
        </>,
      );
    case "exciter":
      return page(
        {},
        <>
          <ParamRow label={t("effects.frequency")} hint={t("devices.exciter.frequency")}>
            <Slider
              label={t("effects.frequency")}
              value={fx.exciter.frequencyHz}
              min={1000}
              max={8000}
              step={100}
              reset={3000}
              format={kHz}
              marks={[
                [1000, "1 kHz"],
                [3000, "3"],
                [5000, "5"],
                [8000, "8 kHz"],
              ]}
              onChange={(frequencyHz) => set("exciter", { frequencyHz })}
            />
          </ParamRow>
          <ParamRow label={t("effects.amount")} hint={t("devices.exciter.amount")}>
            <Slider
              label={t("effects.amount")}
              value={fx.exciter.amount}
              min={0}
              max={1}
              step={0.01}
              reset={0.3}
              format={percent}
              marks={[
                [0, "0 %"],
                [0.5, "50 %"],
                [1, "100 %"],
              ]}
              onChange={(amount) => set("exciter", { amount })}
            />
          </ParamRow>
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
          (["gate", "denoise", "eq", "agc"] as const).map(key),
          (["compressor", "deEsser", "exciter", "limiter"] as const).map(key),
          ...(plugin.available ? [[{ id: "plugin", title: plugin.loaded?.name ?? t("plugins.page"), icon: ICONS.plugin, enabled: !!plugin.loaded && !plugin.bypass }]] : []),
        ]}
      />
      <Crossfade id={open} order={ids}>
        {open === "plugin" ? <PluginsPanel embedded /> : <Device id={open} />}
      </Crossfade>
    </div>
  );
}
