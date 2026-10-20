import { useEffect, useRef, useState } from "react";
import { PluginsPanel } from "~/components/effects/PluginsPanel";
import { ArrowLineUp, ArrowsInLineVertical, Broom, Door, Equalizer, Gauge, Microphone, Plug, SpeakerHigh, Sun, Waves } from "@phosphor-icons/react";
import { ActiveGrid, ChainList, DragArea, EQ_RANGE, EqDisplay, GridLine, Handle, HandleLine, Module, PLOT_Y, ReductionMeter, Tick, YAxis, freqX, smooth } from "~/components/effects/rack";
import { EmptyState } from "~/components/ui/misc";
import type { EffectsParams } from "~/lib/engine";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButtons } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
import { actions, useStore } from "~/lib/store";
import { formatDb, gainToDb } from "~/lib/utils";
import { t } from "~/lib/i18n";
import { plugins, usePlugins } from "~/lib/plugins";

/* Die Aufbereitung des Mikrofons wie in einem modernen Plugin: links die
   Kette als Liste mit Schaltern, rechts die Geräte der gewählten Gruppe im
   Raster. Schwellen, Grenzen und EQ-Punkte lassen sich direkt in der Anzeige
   ziehen; jede Anzeige reicht genau über den Regelweg und sagt am Griff, was
   er einstellt. */

const db = (v: number) => `${formatDb(v)} dB`;
const kHz = (v: number) => `${(v / 1000).toFixed(1)} kHz`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 80 Schritte zu 100 ms = 8 s Verlauf. */
const HISTORY = 80;
const STEP_MS = 100;

/**
 * Verlauf eines Werts in festem Takt, egal wie oft die Seite neu zeichnet; pro
 * Takt zählt der Höchstwert, damit kurze Laute nicht verloren gehen.
 */
function useHistory(value: number) {
  const peak = useRef(0);
  peak.current = Math.max(peak.current, value);
  const [history, setHistory] = useState<number[]>(() => Array(HISTORY).fill(0));
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = peak.current;
      peak.current = 0;
      setHistory((h) => [...h.slice(1), v]);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, []);
  return history;
}

/** Mikrofonpegel in dB, solange die Engine läuft. */
function useMicDb() {
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0) : 0));
  return gainToDb(peak, -90);
}

/** Runde Skalenwerte in einem Bereich, alle `step` dB. */
function dbTicks(lo: number, hi: number, step: number) {
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return ticks;
}

/**
 * Pegelverlauf als feine Balken mit einer ziehbaren Linie (Schwelle, Ziel,
 * Obergrenze). Die Anzeige reicht über `axis` (dB), so weit wie der Regelweg
 * plus etwas Luft; links die dB-Skala.
 */
function LevelDisplay({
  label,
  value,
  onChange,
  min,
  max,
  axis,
  above = "color",
}: {
  label: string;
  value: number;
  onChange: (db: number) => void;
  min: number;
  max: number;
  axis: [number, number];
  above?: "color" | "muted";
}) {
  const [lo, hi] = axis;
  const pos = (v: number) => clamp((v - lo) / (hi - lo), 0, 1);
  const history = useHistory(pos(useMicDb()));
  const line = pos(value);
  const step = hi - lo > 40 ? 20 : 10;
  return (
    <>
      <YAxis bottom={3} ticks={dbTicks(lo, hi, step).map((v) => [(1 - pos(v)) * 100, String(v)])} />
      <div className="absolute top-3 right-3 bottom-3 left-10">
        <Bars
          values={history}
          align="bottom"
          stretch
          bar={3}
          gap={2}
          min={0.01}
          color={(_, v, el) => ((v > line) === (above === "color") ? [cssColor(el, "--ch-mic"), 0.9] : [cssColor(el, "--muted-foreground"), 0.28])}
          deps={[history, line]}
          className="size-full"
        />
        <HandleLine y={(1 - line) * 100} label={`${label} ${db(value)}`} />
        <DragArea title={label} className="inset-0 cursor-ns-resize" onDrag={(_, y) => onChange(clamp(Math.round(lo + y * (hi - lo)), min, max))} />
      </div>
    </>
  );
}

/** Verlauf der Spracherkennung: Sprache grün, alles andere grau. */
function VoiceDisplay({ voice }: { voice: number }) {
  const history = useHistory(voice);
  return (
    <div className="absolute inset-3 bottom-6">
      <Bars
        values={history}
        align="center"
        stretch
        bar={3}
        gap={2}
        min={0.03}
        color={(_, v, el) => (v > 0.6 ? [cssColor(el, "--success"), 1] : [cssColor(el, "--muted-foreground"), 0.28])}
        deps={[history]}
        className="size-full"
      />
      <div className="absolute inset-x-0 -bottom-5 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>−8 s</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-[var(--success)]" /> {t("effects.voice")}
        </span>
        <span>{t("effects.now")}</span>
      </div>
    </div>
  );
}

/**
 * Band ab einer Frequenz als Fläche über einer eigenen Frequenzachse
 * `range` (logarithmisch); der Punkt setzt Frequenz (waagrecht) und Höhe
 * (senkrecht, 0–1).
 */
function BandDisplay({
  range,
  frequencyHz,
  level,
  label,
  yTicks,
  onDrag,
  filled,
}: {
  range: [number, number];
  frequencyHz: number;
  level: number;
  label: string;
  yTicks: [number, string][];
  onDrag: (frequencyHz: number, level: number) => void;
  /** Fläche nur bis zur Höhe des Punkts, z. B. eine Anhebung. */
  filled?: boolean;
}) {
  const [lo, hi] = range;
  const fx = (f: number) => (Math.log(f / lo) / Math.log(hi / lo)) * 100;
  const x = fx(frequencyHz);
  const top = (1 - level) * 100;
  const ticks = [2000, 4000, 8000].filter((f) => f > lo * 1.05 && f < hi * 0.97);
  return (
    <>
      <YAxis ticks={yTicks.map(([p, text]) => [(1 - p) * 100, text])} />
      <div className={PLOT_Y}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((f) => (
            <GridLine key={f} x={fx(f)} />
          ))}
          <rect x={x} y={filled ? top : 0} width={100 - x} height={filled ? 100 - top : 100} fill="var(--ch-mic)" fillOpacity=".16" />
          <line x1={x} x2={x} y1="0" y2="100" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <line
            x1={x}
            x2="100"
            y1={top}
            y2={top}
            stroke="var(--ch-mic)"
            strokeDasharray={filled ? undefined : "4 3"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <Handle x={x} y={top} label={label} />
        <DragArea className="inset-0 cursor-move" onDrag={(px, py) => onDrag(lo * Math.pow(hi / lo, px), py)} />
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-10 h-6">
        {ticks.map((f) => (
          <Tick key={f} axis="x" at={fx(f)}>
            {f / 1000} kHz
          </Tick>
        ))}
      </div>
    </>
  );
}

const EQ_BANDS = [
  { key: "lowDb", f: 120, label: "effects.bass" },
  { key: "midDb", f: 2000, label: "effects.presence" },
  { key: "highDb", f: 11000, label: "effects.treble" },
] as const;

/** EQ-Kurve mit drei Punkten zum Ziehen: hoch hebt an, runter senkt ab. */
function EqEditor() {
  const eq = useStore((s) => s.effects.eq);
  const dy = (v: number) => 50 - (v / EQ_RANGE) * 50;
  return (
    <>
      <EqDisplay low={eq.lowDb} mid={eq.midDb} high={eq.highDb} />
      <div className={PLOT_Y}>
        {EQ_BANDS.map((b) => (
          <Handle key={b.key} x={freqX(b.f)} y={dy(eq[b.key])} />
        ))}
        <DragArea
          className="inset-0 cursor-ns-resize"
          onDrag={(x, y) => {
            const band = EQ_BANDS.reduce((best, b) => (Math.abs(freqX(b.f) / 100 - x) < Math.abs(freqX(best.f) / 100 - x) ? b : best));
            actions.setEffect("eq", { [band.key]: clamp(Math.round((y - 0.5) * 2 * EQ_RANGE * 2) / 2, -12, 12) });
          }}
        />
      </div>
    </>
  );
}

const IN_MIN = -50;

/**
 * Kennlinie des Kompressors: waagrecht was hineingeht, senkrecht was
 * herauskommt. Bis zur Schwelle geradeaus, darüber flacher. Der Punkt an der
 * Schwelle lässt sich über die ganze Breite ziehen, der Ball zeigt den
 * aktuellen Pegel.
 */
function CompressorDisplay({ thresholdDb, ratio }: { thresholdDb: number; ratio: number }) {
  const input = useMicDb();
  const out = (i: number) => (i <= thresholdDb ? i : thresholdDb + (i - thresholdDb) / ratio);
  const x = (i: number) => ((i - IN_MIN) / -IN_MIN) * 100;
  const y = (o: number) => 100 - ((o - IN_MIN) / -IN_MIN) * 100;
  const points = [IN_MIN, thresholdDb, 0].map((i) => `${x(i)},${y(out(i))}`).join(" ");
  const now = clamp(input, IN_MIN, 0);
  const ticks = [-40, -20];
  return (
    <>
      <YAxis ticks={ticks.map((v) => [y(v), String(v)])} />
      <div className="absolute top-3 right-3 bottom-6 left-10">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((v) => (
            <GridLine key={v} x={x(v)} />
          ))}
          {ticks.map((v) => (
            <GridLine key={`y${v}`} y={y(v)} />
          ))}
          <line x1="0" y1="100" x2="100" y2="0" stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={points} fill="none" stroke="var(--ch-mic)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="pointer-events-none absolute top-0 left-1 font-mono text-[9px] text-muted-foreground">{t("effects.output")} ↑</span>
        {input > IN_MIN && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
            style={{ left: `${x(now)}%`, top: `${y(out(now))}%` }}
          />
        )}
        <Handle x={x(thresholdDb)} y={y(thresholdDb)} label={`${t("effects.threshold")} ${db(thresholdDb)}`} />
        <DragArea
          className="inset-0 cursor-ew-resize"
          onDrag={(px) => actions.setEffect("compressor", { thresholdDb: clamp(Math.round(IN_MIN + px * -IN_MIN), -50, 0) })}
        />
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-10 h-6">
        {ticks.map((v) => (
          <Tick key={v} axis="x" at={x(v)}>
            {v}
          </Tick>
        ))}
        <span className="absolute right-0 bottom-1.5 font-mono text-[9px] text-muted-foreground">{t("effects.input")} →</span>
      </div>
    </>
  );
}

const RATIOS: { value: number; label: string }[] = [
  { value: 2, label: "effects.ratioSoft" },
  { value: 4, label: "effects.ratioMedium" },
  { value: 8, label: "effects.ratioHard" },
];

/** Ein- und Ausschalten mit weichem Übergang der Karten. */
function toggle(id: Exclude<keyof EffectsParams, "voice">, enabled: boolean) {
  smooth(() => actions.setEffect(id, { enabled }));
}

function Device({ id, highlight, className }: { id: string; highlight: boolean; className?: string }) {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const running = useStore((s) => s.info !== null);
  const reduction = (key: "compressorDb" | "deEsserDb" | "limiterDb") => (running ? (live?.[key] ?? 0) : 0);

  switch (id) {
    case "gate":
      return (
        <Module
          className={className}
          name="fx-gate"
          title={t("effects.gate")}
          help="gate"
          highlight={highlight}
          enabled={fx.gate.enabled}
          onToggle={(enabled) => toggle("gate", enabled)}
          display={
            <LevelDisplay
              label={t("effects.threshold")}
              value={fx.gate.thresholdDb}
              min={-70}
              max={-10}
              axis={[-70, -10]}
              onChange={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
            />
          }
        >
          <Knob
            label={t("effects.threshold")}
            value={fx.gate.thresholdDb}
            min={-70}
            max={-10}
            step={1}
            reset={-50}
            format={db}
            onChange={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
          />
        </Module>
      );
    case "denoise":
      return (
        <Module
          name="fx-denoise"
          className={className}
          title={t("effects.denoise")}
          help="denoise"
          highlight={highlight}
          enabled={fx.denoise.enabled}
          onToggle={(enabled) => toggle("denoise", enabled)}
          display={<VoiceDisplay voice={running && fx.denoise.enabled ? (live?.voice ?? 0) : 0} />}
          keys={
            <PushButtons
              value={fx.denoise.voiceGate ? "voice" : "all"}
              onChange={(v) => actions.setEffect("denoise", { voiceGate: v === "voice" })}
              options={[
                { value: "all", label: t("effects.letAll"), title: t("effects.letAllHint") },
                { value: "voice", label: t("effects.voiceOnly"), title: t("effects.voiceGate") },
              ]}
            />
          }
        >
          <Knob
            label={t("effects.amount")}
            value={fx.denoise.strength}
            min={0}
            max={1}
            step={0.01}
            reset={1}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(strength) => actions.setEffect("denoise", { strength })}
          />
        </Module>
      );
    case "eq":
      return (
        <Module
          className={className}
          name="fx-eq"
          title={t("effects.eq")}
          help="eq"
          stacked
          highlight={highlight}
          enabled={fx.eq.enabled}
          onToggle={(enabled) => toggle("eq", enabled)}
          display={<EqEditor />}
        >
          {EQ_BANDS.map((b) => (
            <Knob
              key={b.key}
              label={t(b.label)}
              value={fx.eq[b.key]}
              min={-12}
              max={12}
              step={0.5}
              reset={0}
              bipolar
              format={db}
              onChange={(v) => actions.setEffect("eq", { [b.key]: v })}
            />
          ))}
        </Module>
      );
    case "agc":
      return (
        <Module
          className={className}
          name="fx-agc"
          title={t("effects.agc")}
          help="agc"
          highlight={highlight}
          enabled={fx.agc.enabled}
          onToggle={(enabled) => toggle("agc", enabled)}
          display={
            <LevelDisplay
              label={t("effects.target")}
              value={fx.agc.targetDb}
              min={-30}
              max={-10}
              axis={[-34, -6]}
              above="muted"
              onChange={(targetDb) => actions.setEffect("agc", { targetDb })}
            />
          }
        >
          <Knob
            label={t("effects.target")}
            value={fx.agc.targetDb}
            min={-30}
            max={-10}
            step={1}
            reset={-20}
            format={db}
            onChange={(targetDb) => actions.setEffect("agc", { targetDb })}
          />
          <Knob
            label={t("effects.maxGain")}
            value={fx.agc.maxGainDb}
            min={0}
            max={30}
            step={1}
            reset={18}
            format={(v) => `+${v} dB`}
            onChange={(maxGainDb) => actions.setEffect("agc", { maxGainDb })}
          />
        </Module>
      );
    case "compressor":
      return (
        <Module
          className={className}
          name="fx-compressor"
          title={t("effects.compressor")}
          help="compressor"
          highlight={highlight}
          enabled={fx.compressor.enabled}
          onToggle={(enabled) => toggle("compressor", enabled)}
          keys={
            <PushButtons
              value={RATIOS.reduce((best, r) => (Math.abs(r.value - fx.compressor.ratio) < Math.abs(best - fx.compressor.ratio) ? r.value : best), 4)}
              options={RATIOS.map((r) => ({ value: r.value, label: t(r.label), title: `${r.value}:1` }))}
              onChange={(ratio) => actions.setEffect("compressor", { ratio })}
            />
          }
          meter={<ReductionMeter db={fx.compressor.enabled ? reduction("compressorDb") : 0} max={18} label={t("effects.reduction")} />}
          display={
            <CompressorDisplay
              thresholdDb={fx.compressor.thresholdDb}
              ratio={fx.compressor.ratio}
            />
          }
        >

          <Knob
            label={t("effects.threshold")}
            value={fx.compressor.thresholdDb}
            min={-50}
            max={0}
            step={1}
            reset={-20}
            format={db}
            onChange={(thresholdDb) => actions.setEffect("compressor", { thresholdDb })}
          />
          <Knob
            label={t("effects.makeup")}
            value={fx.compressor.makeupDb}
            min={0}
            max={18}
            step={0.5}
            reset={4}
            format={(v) => `+${v.toFixed(1)} dB`}
            onChange={(makeupDb) => actions.setEffect("compressor", { makeupDb })}
          />
        </Module>
      );
    case "deEsser":
      return (
        <Module
          className={className}
          name="fx-deEsser"
          title={t("effects.deEsser")}
          help="deEsser"
          highlight={highlight}
          enabled={fx.deEsser.enabled}
          onToggle={(enabled) => toggle("deEsser", enabled)}
          meter={<ReductionMeter db={fx.deEsser.enabled ? reduction("deEsserDb") : 0} max={18} label={t("effects.reduction")} />}
          display={
            <BandDisplay
              range={[3000, 10000]}
              frequencyHz={fx.deEsser.frequencyHz}
              level={(fx.deEsser.thresholdDb + 60) / 60}
              label={`${kHz(fx.deEsser.frequencyHz)} · ${db(fx.deEsser.thresholdDb)}`}
              yTicks={[
                [0, "−60"],
                [0.5, "−30"],
                [1, "0"],
              ]}
              onDrag={(f, level) =>
                actions.setEffect("deEsser", {
                  frequencyHz: clamp(Math.round(f / 100) * 100, 3000, 10000),
                  thresholdDb: clamp(Math.round(level * 60 - 60), -60, 0),
                })
              }
            />
          }
        >
          <Knob
            label={t("effects.threshold")}
            value={fx.deEsser.thresholdDb}
            min={-60}
            max={0}
            step={1}
            reset={-30}
            format={db}
            onChange={(thresholdDb) => actions.setEffect("deEsser", { thresholdDb })}
          />
          <Knob
            label={t("effects.frequency")}
            value={fx.deEsser.frequencyHz}
            min={3000}
            max={10000}
            step={100}
            reset={6000}
            format={kHz}
            onChange={(frequencyHz) => actions.setEffect("deEsser", { frequencyHz })}
          />
        </Module>
      );
    case "exciter":
      return (
        <Module
          className={className}
          name="fx-exciter"
          title={t("effects.exciter")}
          help="exciter"
          highlight={highlight}
          enabled={fx.exciter.enabled}
          onToggle={(enabled) => toggle("exciter", enabled)}
          display={
            <BandDisplay
              range={[1000, 8000]}
              frequencyHz={fx.exciter.frequencyHz}
              level={fx.exciter.amount}
              filled
              label={`${kHz(fx.exciter.frequencyHz)} · ${Math.round(fx.exciter.amount * 100)} %`}
              yTicks={[
                [0, "0 %"],
                [0.5, "50 %"],
                [1, "100 %"],
              ]}
              onDrag={(f, level) =>
                actions.setEffect("exciter", {
                  frequencyHz: clamp(Math.round(f / 100) * 100, 1000, 8000),
                  amount: clamp(Math.round(level * 100) / 100, 0, 1),
                })
              }
            />
          }
        >
          <Knob
            label={t("effects.frequency")}
            value={fx.exciter.frequencyHz}
            min={1000}
            max={8000}
            step={100}
            reset={3000}
            format={kHz}
            onChange={(frequencyHz) => actions.setEffect("exciter", { frequencyHz })}
          />
          <Knob
            label={t("effects.amount")}
            value={fx.exciter.amount}
            min={0}
            max={1}
            step={0.01}
            reset={0.3}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(amount) => actions.setEffect("exciter", { amount })}
          />
        </Module>
      );
    case "limiter":
      return (
        <Module
          className={className}
          name="fx-limiter"
          title={t("effects.limiter")}
          help="limiter"
          highlight={highlight}
          enabled={fx.limiter.enabled}
          onToggle={(enabled) => toggle("limiter", enabled)}
          meter={<ReductionMeter db={fx.limiter.enabled ? reduction("limiterDb") : 0} max={12} label={t("effects.reduction")} />}
          display={
            <LevelDisplay
              label={t("effects.ceiling")}
              value={fx.limiter.ceilingDb}
              min={-20}
              max={0}
              axis={[-24, 0]}
              onChange={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
            />
          }
        >
          <Knob
            label={t("effects.ceiling")}
            value={fx.limiter.ceilingDb}
            min={-20}
            max={0}
            step={0.5}
            reset={-3}
            format={db}
            onChange={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
          />
        </Module>
      );
    default:
      return <PluginsPanel embedded />;
  }
}

const GROUPS = {
  clean: ["gate", "denoise", "eq", "agc"],
  dynamics: ["compressor", "deEsser", "exciter", "limiter"],
} as const;
type DeviceId = (typeof GROUPS)[keyof typeof GROUPS][number];

const ICONS: Record<DeviceId, React.ReactNode> = {
  gate: <Door />,
  denoise: <Broom />,
  eq: <Equalizer />,
  agc: <Gauge />,
  compressor: <ArrowsInLineVertical />,
  deEsser: <Waves />,
  exciter: <Sun />,
  limiter: <ArrowLineUp />,
};

/** Welche Anzeige am meisten Platz verdient, wenn welcher übrig ist. */
const WEIGHT: Record<DeviceId, number> = { eq: 8, compressor: 7, gate: 6, agc: 5, deEsser: 4, exciter: 3, limiter: 2, denoise: 1 };

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const plugin = usePlugins((s) => s.status);
  const [flash, setFlash] = useState<string | null>(null);
  // Plugin-Slot: an, solange ein Plugin läuft; ohne Plugin zeigt „an“ die Suche.
  const [browsing, setBrowsing] = useState(false);
  const pluginOn = plugin.available && ((!!plugin.loaded && !plugin.bypass) || (!plugin.loaded && browsing));
  useEffect(() => {
    void plugins.refresh();
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const chain = (id: DeviceId) => ({
    id,
    title: t(`effects.${id}`),
    icon: ICONS[id],
    enabled: fx[id].enabled,
    onToggle: (enabled: boolean) => toggle(id, enabled),
  });
  const active = [...GROUPS.clean, ...GROUPS.dynamics].filter((id) => fx[id].enabled);

  return (
    <div className="flex h-full gap-3 overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <div className="flex shrink-0 flex-col gap-3">
        <ChainList
          start={{ label: t("effects.input"), icon: <Microphone /> }}
          end={{ label: t("effects.output"), icon: <SpeakerHigh /> }}
          groups={[
            { title: t("effects.cleanPage"), devices: GROUPS.clean.map(chain) },
            { title: t("effects.dynamicsPage"), devices: GROUPS.dynamics.map(chain) },
            ...(plugin.available
              ? [
                  {
                    title: t("plugins.page"),
                    devices: [
                      {
                        id: "plugin",
                        title: plugin.loaded?.name ?? t("plugins.page"),
                        icon: <Plug />,
                        enabled: pluginOn,
                        onToggle: (on: boolean) =>
                          smooth(() => {
                            setBrowsing(on);
                            if (plugin.loaded) void plugins.setBypass(!on);
                          }),
                      },
                    ],
                  },
                ]
              : []),
          ]}
          onFocus={setFlash}
        />
      </div>
      <ActiveGrid
        empty={<EmptyState icon={<Equalizer weight="duotone" />} title={t("effects.noneTitle")}>{t("effects.noneHint")}</EmptyState>}
        items={[
          ...active.map((id) => ({
            id,
            weight: WEIGHT[id],
            render: (className: string) => <Device id={id} highlight={flash === id} className={className} />,
          })),
          ...(pluginOn ? [{ id: "plugin", weight: 9, render: () => <PluginsPanel embedded /> }] : []),
        ]}
      />
    </div>
  );
}
