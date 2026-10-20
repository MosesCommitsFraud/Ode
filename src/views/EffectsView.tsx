import { useEffect, useRef, useState } from "react";
import { PluginsPanel } from "~/components/effects/PluginsPanel";
import { Bench, DeviceGrid, DragArea, EQ_RANGE, EqDisplay, GridLine, Handle, HandleLine, Module, PLOT_Y, Tick, YAxis, freqX } from "~/components/effects/rack";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButton, PushButtons } from "~/components/ui/hardware";
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
  reductionDb,
  reductionMax = 12,
}: {
  label: string;
  value: number;
  onChange: (db: number) => void;
  min: number;
  max: number;
  axis: [number, number];
  above?: "color" | "muted";
  reductionDb?: number;
  reductionMax?: number;
}) {
  const [lo, hi] = axis;
  const pos = (v: number) => clamp((v - lo) / (hi - lo), 0, 1);
  const history = useHistory(pos(useMicDb()));
  const line = pos(value);
  const step = hi - lo > 40 ? 20 : 10;
  return (
    <>
      <YAxis bottom={3} ticks={dbTicks(lo, hi, step).map((v) => [(1 - pos(v)) * 100, String(v)])} />
      <div className={reductionDb !== undefined ? "absolute top-3 right-8 bottom-3 left-10" : "absolute top-3 right-3 bottom-3 left-10"}>
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
      {reductionDb !== undefined && <ReductionBar db={reductionDb} max={reductionMax} />}
    </>
  );
}

/** Wie stark ein Gerät gerade absenkt: Balken am rechten Rand, wächst von oben. */
function ReductionBar({ db: level, max }: { db: number; max: number }) {
  return (
    <div title={t("effects.reduction")} className="absolute top-3 right-3 bottom-3 w-2 overflow-hidden rounded-full bg-[var(--meter-track)]">
      <div className="w-full rounded-full bg-[var(--ch-mic)] transition-[height] duration-100" style={{ height: `${clamp(-level / max, 0, 1) * 100}%` }} />
    </div>
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

const EQ_BANDS = [
  { key: "lowDb", f: 120, label: "effects.bass" },
  { key: "midDb", f: 2500, label: "effects.presence" },
  { key: "highDb", f: 8000, label: "effects.treble" },
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
          <Handle key={b.key} x={freqX(b.f)} y={dy(eq[b.key])} label={`${formatDb(eq[b.key])} dB`} />
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
function CompressorDisplay({ thresholdDb, ratio, reductionDb }: { thresholdDb: number; ratio: number; reductionDb: number }) {
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
      <div className="absolute top-3 right-8 bottom-6 left-10">
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
      <div className="pointer-events-none absolute right-8 bottom-0 left-10 h-6">
        {ticks.map((v) => (
          <Tick key={v} axis="x" at={x(v)}>
            {v}
          </Tick>
        ))}
        <span className="absolute right-0 bottom-1.5 font-mono text-[9px] text-muted-foreground">{t("effects.input")} →</span>
      </div>
      <ReductionBar db={reductionDb} max={18} />
    </>
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
  reductionDb,
  filled,
}: {
  range: [number, number];
  frequencyHz: number;
  level: number;
  label: string;
  yTicks: [number, string][];
  onDrag: (frequencyHz: number, level: number) => void;
  reductionDb?: number;
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
      <div className={reductionDb !== undefined ? "absolute top-3 right-8 bottom-6 left-10" : PLOT_Y}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((f) => (
            <GridLine key={f} x={fx(f)} />
          ))}
          <rect x={x} y={filled ? top : 0} width={100 - x} height={filled ? 100 - top : 100} fill="var(--ch-mic)" fillOpacity=".16" />
          <line x1={x} x2={x} y1="0" y2="100" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <line x1={x} x2="100" y1={top} y2={top} stroke="var(--ch-mic)" strokeDasharray={filled ? undefined : "4 3"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <Handle x={x} y={top} label={label} />
        <DragArea className="inset-0 cursor-move" onDrag={(px, py) => onDrag(lo * Math.pow(hi / lo, px), py)} />
      </div>
      <div className={reductionDb !== undefined ? "pointer-events-none absolute right-8 bottom-0 left-10 h-6" : "pointer-events-none absolute right-3 bottom-0 left-10 h-6"}>
        {ticks.map((f) => (
          <Tick key={f} axis="x" at={fx(f)}>
            {f / 1000} kHz
          </Tick>
        ))}
      </div>
      {reductionDb !== undefined && <ReductionBar db={reductionDb} max={18} />}
    </>
  );
}

const RATIOS: { value: number; label: string }[] = [
  { value: 2, label: "effects.ratioSoft" },
  { value: 4, label: "effects.ratioMedium" },
  { value: 8, label: "effects.ratioHard" },
];

function Device({ id, highlight }: { id: string; highlight: boolean }) {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const running = useStore((s) => s.info !== null);
  const reduction = (key: "compressorDb" | "deEsserDb" | "limiterDb") => (running ? (live?.[key] ?? 0) : 0);

  switch (id) {
    case "gate":
      return (
        <Module
          title={t("effects.gate")}
          help="gate"
          highlight={highlight}
          enabled={fx.gate.enabled}
          onToggle={(enabled) => actions.setEffect("gate", { enabled })}
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
          title={t("effects.denoise")}
          help="denoise"
          highlight={highlight}
          enabled={fx.denoise.enabled}
          onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
          display={<VoiceDisplay voice={running && fx.denoise.enabled ? (live?.voice ?? 0) : 0} />}
          keys={<PushButton label={t("effects.voiceGate")} on={fx.denoise.voiceGate} onChange={(voiceGate) => actions.setEffect("denoise", { voiceGate })} />}
        />
      );
    case "eq":
      return (
        <Module
          title={t("effects.eq")}
          help="eq"
          highlight={highlight}
          enabled={fx.eq.enabled}
          onToggle={(enabled) => actions.setEffect("eq", { enabled })}
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
          title={t("effects.agc")}
          help="agc"
          highlight={highlight}
          enabled={fx.agc.enabled}
          onToggle={(enabled) => actions.setEffect("agc", { enabled })}
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
          title={t("effects.compressor")}
          help="compressor"
          highlight={highlight}
          enabled={fx.compressor.enabled}
          onToggle={(enabled) => actions.setEffect("compressor", { enabled })}
          display={
            <CompressorDisplay
              thresholdDb={fx.compressor.thresholdDb}
              ratio={fx.compressor.ratio}
              reductionDb={fx.compressor.enabled ? reduction("compressorDb") : 0}
            />
          }
        >
            <PushButtons
              className="w-44 self-center"
              label={t("effects.ratio")}
              value={RATIOS.reduce((best, r) => (Math.abs(r.value - fx.compressor.ratio) < Math.abs(best - fx.compressor.ratio) ? r.value : best), 4)}
              options={RATIOS.map((r) => ({ value: r.value, label: t(r.label), title: `${r.value}:1` }))}
              onChange={(ratio) => actions.setEffect("compressor", { ratio })}
            />

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
          title={t("effects.deEsser")}
          help="deEsser"
          highlight={highlight}
          enabled={fx.deEsser.enabled}
          onToggle={(enabled) => actions.setEffect("deEsser", { enabled })}
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
              reductionDb={fx.deEsser.enabled ? reduction("deEsserDb") : 0}
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
          title={t("effects.exciter")}
          help="exciter"
          highlight={highlight}
          enabled={fx.exciter.enabled}
          onToggle={(enabled) => actions.setEffect("exciter", { enabled })}
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
          title={t("effects.limiter")}
          help="limiter"
          highlight={highlight}
          enabled={fx.limiter.enabled}
          onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
          display={
            <LevelDisplay
              label={t("effects.ceiling")}
              value={fx.limiter.ceilingDb}
              min={-20}
              max={0}
              axis={[-24, 0]}
              reductionDb={fx.limiter.enabled ? reduction("limiterDb") : 0}
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
const KEY = "ode.effects-open";

function readOpen(): { group: string; device?: string } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") as { group: string; device?: string };
  } catch {
    return { group: "clean" };
  }
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const plugin = usePlugins((s) => s.status);
  const [state, setState] = useState(readOpen);
  const [flash, setFlash] = useState<string | null>(null);
  const valid = ["clean", "dynamics", ...(plugin.available ? ["plugin"] : [])];
  const group = valid.includes(state.group) ? state.group : "clean";
  useEffect(() => {
    void plugins.refresh();
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const open = (next: string, device?: string) => {
    const value = { group: next, device };
    setState(value);
    if (device) setFlash(device);
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Nur Komfort.
    }
  };
  const device = (id: DeviceId) => ({
    id,
    title: t(`effects.${id}`),
    enabled: fx[id].enabled,
    onToggle: (enabled: boolean) => actions.setEffect(id, { enabled }),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <Bench
        open={group}
        focus={state.device}
        onOpen={open}
        groups={[
          { id: "clean", title: t("effects.cleanPage"), devices: GROUPS.clean.map(device) },
          { id: "dynamics", title: t("effects.dynamicsPage"), devices: GROUPS.dynamics.map(device) },
          ...(plugin.available
            ? [
                {
                  id: "plugin",
                  title: t("plugins.page"),
                  devices: [
                    {
                      id: "plugin",
                      title: plugin.loaded?.name ?? t("plugins.emptyTitle"),
                      enabled: !!plugin.loaded && !plugin.bypass,
                      onToggle: plugin.loaded ? (on: boolean) => void plugins.setBypass(!on) : undefined,
                    },
                  ],
                },
              ]
            : []),
        ]}
      >
        {group === "plugin" ? (
          <PluginsPanel embedded />
        ) : (
          <DeviceGrid count={4}>
            {GROUPS[group as keyof typeof GROUPS].map((id) => (
              <Device key={id} id={id} highlight={flash === id} />
            ))}
          </DeviceGrid>
        )}
      </Bench>
    </div>
  );
}
