import { useEffect, useRef, useState } from "react";
import { PluginsPanel } from "~/components/effects/PluginsPanel";
import { Bench, DragArea, EqDisplay, GridLine, Handle, HandleLine, Module, PLOT, Tick, freqX } from "~/components/effects/rack";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButton, PushButtons } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
import { actions, useStore } from "~/lib/store";
import { formatDb, gainToDb } from "~/lib/utils";
import { t } from "~/lib/i18n";
import { plugins, usePlugins } from "~/lib/plugins";

/* Die Aufbereitung des Mikrofons wie in einem modernen Plugin: links die
   Kette als Liste mit Schaltern, rechts das gewählte Gerät mit großer
   Anzeige. Schwellen, Grenzen und EQ-Punkte lassen sich direkt in der
   Anzeige ziehen; die Drehregler darunter machen dasselbe. */

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

const FLOOR = -70;
/** Pegel in dB auf 0–1 der Anzeige. */
const levelPos = (v: number) => clamp((v - FLOOR) / -FLOOR, 0, 1);
const posLevel = (p: number) => FLOOR + p * -FLOOR;

/** Mikrofonpegel, solange die Engine läuft. */
function useMicDb() {
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0) : 0));
  return gainToDb(peak, FLOOR);
}

/**
 * Pegelverlauf als feine Balken mit einer ziehbaren Linie (Schwelle, Ziel,
 * Obergrenze). `above`: wie Balken über der Linie aussehen.
 */
function LevelDisplay({
  lineDb,
  onLine,
  min,
  max,
  above = "color",
  title,
}: {
  lineDb: number;
  onLine: (db: number) => void;
  min: number;
  max: number;
  above?: "color" | "muted";
  title: string;
}) {
  const history = useHistory(levelPos(useMicDb()));
  const line = levelPos(lineDb);
  return (
    <div className="absolute inset-3">
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
      <HandleLine y={(1 - line) * 100} />
      <DragArea title={title} className="inset-0 cursor-ns-resize" onDrag={(_, y) => onLine(clamp(Math.round(posLevel(y)), min, max))} />
    </div>
  );
}

/** Wie stark ein Gerät gerade absenkt: Balken am rechten Rand, wächst von oben. */
function ReductionBar({ db: level, max }: { db: number; max: number }) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 bottom-3 w-2 overflow-hidden rounded-full bg-[var(--meter-track)]">
      <div className="w-full rounded-full bg-[var(--ch-mic)] transition-[height] duration-100" style={{ height: `${clamp(-level / max, 0, 1) * 100}%` }} />
    </div>
  );
}

/** Verlauf der Spracherkennung: Sprache in Farbe, alles andere grau. */
function VoiceDisplay({ voice }: { voice: number }) {
  const history = useHistory(voice);
  return (
    <div className="absolute inset-3">
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
    </div>
  );
}

const EQ_BANDS = [
  { key: "lowDb", f: 120 },
  { key: "midDb", f: 2500 },
  { key: "highDb", f: 8000 },
] as const;

/** EQ-Kurve mit drei Punkten zum Ziehen: hoch hebt an, runter senkt ab. */
function EqEditor() {
  const eq = useStore((s) => s.effects.eq);
  const dy = (v: number) => 50 - (v / 15) * 50;
  return (
    <>
      <EqDisplay low={eq.lowDb} mid={eq.midDb} high={eq.highDb} />
      <div className="pointer-events-none absolute top-3 right-3 bottom-6 left-3">
        {EQ_BANDS.map((b) => (
          <Handle key={b.key} x={freqX(b.f)} y={dy(eq[b.key])} />
        ))}
      </div>
      <DragArea
        className="top-3 right-3 bottom-6 left-3 cursor-ns-resize"
        onDrag={(x, y) => {
          const band = EQ_BANDS.reduce((best, b) => (Math.abs(freqX(b.f) / 100 - x) < Math.abs(freqX(best.f) / 100 - x) ? b : best));
          actions.setEffect("eq", { [band.key]: clamp(Math.round((y - 0.5) * 30 * 2) / 2, -12, 12) });
        }}
      />
    </>
  );
}

const IN_MIN = -60;

/**
 * Kennlinie des Kompressors: waagrecht der Eingang, senkrecht der Ausgang.
 * Bis zur Schwelle geradeaus, darüber flacher. Der Punkt an der Schwelle
 * lässt sich ziehen, der Ball zeigt den aktuellen Pegel.
 */
function CompressorDisplay({ thresholdDb, ratio, reductionDb }: { thresholdDb: number; ratio: number; reductionDb: number }) {
  const input = useMicDb();
  const out = (i: number) => (i <= thresholdDb ? i : thresholdDb + (i - thresholdDb) / ratio);
  const x = (i: number) => ((i - IN_MIN) / -IN_MIN) * 100;
  const y = (o: number) => 100 - ((o - IN_MIN) / -IN_MIN) * 100;
  const points = [IN_MIN, thresholdDb, 0].map((i) => `${x(i)},${y(out(i))}`).join(" ");
  const now = clamp(input, IN_MIN, 0);
  return (
    <>
      <div className="absolute top-3 right-8 bottom-3 left-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {[-48, -36, -24, -12].map((v) => (
            <GridLine key={v} x={x(v)} />
          ))}
          {[-48, -36, -24, -12].map((v) => (
            <GridLine key={`y${v}`} y={y(v)} />
          ))}
          <line x1="0" y1="100" x2="100" y2="0" stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={points} fill="none" stroke="var(--ch-mic)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {input > IN_MIN && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
            style={{ left: `${x(now)}%`, top: `${y(out(now))}%` }}
          />
        )}
        <Handle x={x(thresholdDb)} y={y(thresholdDb)} />
        <DragArea
          className="inset-0 cursor-ew-resize"
          onDrag={(px) => actions.setEffect("compressor", { thresholdDb: clamp(Math.round(IN_MIN + px * -IN_MIN), -50, 0) })}
        />
      </div>
      <ReductionBar db={reductionDb} max={18} />
    </>
  );
}

/** Band ab der Frequenz als Fläche; der Punkt setzt Frequenz (waagrecht) und Höhe (senkrecht). */
function BandDisplay({
  frequencyHz,
  level,
  onDrag,
  reductionDb,
  fill,
}: {
  frequencyHz: number;
  /** Höhe des Punkts 0–1. */
  level: number;
  onDrag: (x: number, y: number) => void;
  reductionDb?: number;
  /** Fläche ab der Frequenz bis zu dieser Höhe (0–1), z. B. die Anhebung. */
  fill?: number;
}) {
  const x = freqX(frequencyHz);
  const top = (1 - level) * 100;
  return (
    <>
      <div className={reductionDb !== undefined ? "absolute top-3 right-8 bottom-6 left-3" : PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {[100, 1000, 10000].map((f) => (
            <GridLine key={f} x={freqX(f)} />
          ))}
          <rect
            x={x}
            y={fill !== undefined ? (1 - fill) * 100 : 0}
            width={100 - x}
            height={fill !== undefined ? fill * 100 : 100}
            fill="var(--ch-mic)"
            fillOpacity=".16"
          />
          <line x1={x} x2={x} y1="0" y2="100" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {fill === undefined && (
            <line x1={x} x2="100" y1={top} y2={top} stroke="var(--ch-mic)" strokeDasharray="4 3" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <Handle x={x} y={fill !== undefined ? (1 - fill) * 100 : top} />
        <DragArea className="inset-0 cursor-move" onDrag={onDrag} />
      </div>
      <div className="pointer-events-none absolute right-8 bottom-0 left-3 h-6">
        <Tick axis="x" at={freqX(120)}>
          {t("effects.bass")}
        </Tick>
        <Tick axis="x" at={freqX(9000)}>
          {t("effects.treble")}
        </Tick>
      </div>
      {reductionDb !== undefined && <ReductionBar db={reductionDb} max={18} />}
    </>
  );
}

/** Frequenz aus der waagrechten Position 0–1 (20 Hz … 20 kHz, logarithmisch). */
const posFreq = (x: number) => 20 * Math.pow(1000, x);

const RATIOS: { value: number; label: string }[] = [
  { value: 2, label: "effects.ratioSoft" },
  { value: 4, label: "effects.ratioMedium" },
  { value: 8, label: "effects.ratioHard" },
];

function Device({ id }: { id: string }) {
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
          enabled={fx.gate.enabled}
          onToggle={(enabled) => actions.setEffect("gate", { enabled })}
          display={
            <LevelDisplay
              title={t("effects.threshold")}
              lineDb={fx.gate.thresholdDb}
              min={-70}
              max={-10}
              onLine={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
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
            size="lg"
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
          enabled={fx.denoise.enabled}
          onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
          display={<VoiceDisplay voice={running && fx.denoise.enabled ? (live?.voice ?? 0) : 0} />}
          keys={<PushButton label={t("effects.voiceGate")} on={fx.denoise.voiceGate} onChange={(voiceGate) => actions.setEffect("denoise", { voiceGate })} />}
        />
      );
    case "eq":
      return (
        <Module title={t("effects.eq")} help="eq" enabled={fx.eq.enabled} onToggle={(enabled) => actions.setEffect("eq", { enabled })} display={<EqEditor />}>
          {(
            [
              ["lowDb", t("effects.bass")],
              ["midDb", t("effects.presence")],
              ["highDb", t("effects.treble")],
            ] as const
          ).map(([key, label]) => (
            <Knob
              key={key}
              label={label}
              value={fx.eq[key]}
              min={-12}
              max={12}
              step={0.5}
              reset={0}
              bipolar
              size="lg"
              format={db}
              onChange={(v) => actions.setEffect("eq", { [key]: v })}
            />
          ))}
        </Module>
      );
    case "agc":
      return (
        <Module
          title={t("effects.agc")}
          help="agc"
          enabled={fx.agc.enabled}
          onToggle={(enabled) => actions.setEffect("agc", { enabled })}
          display={
            <LevelDisplay
              title={t("effects.target")}
              lineDb={fx.agc.targetDb}
              min={-30}
              max={-10}
              above="muted"
              onLine={(targetDb) => actions.setEffect("agc", { targetDb })}
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
            size="lg"
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
            size="lg"
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
          enabled={fx.compressor.enabled}
          onToggle={(enabled) => actions.setEffect("compressor", { enabled })}
          display={
            <CompressorDisplay
              thresholdDb={fx.compressor.thresholdDb}
              ratio={fx.compressor.ratio}
              reductionDb={fx.compressor.enabled ? reduction("compressorDb") : 0}
            />
          }
          keys={
            <PushButtons
              value={RATIOS.reduce((best, r) => (Math.abs(r.value - fx.compressor.ratio) < Math.abs(best - fx.compressor.ratio) ? r.value : best), 4)}
              options={RATIOS.map((r) => ({ value: r.value, label: t(r.label), title: `${r.value}:1` }))}
              onChange={(ratio) => actions.setEffect("compressor", { ratio })}
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
            size="lg"
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
            size="lg"
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
          enabled={fx.deEsser.enabled}
          onToggle={(enabled) => actions.setEffect("deEsser", { enabled })}
          display={
            <BandDisplay
              frequencyHz={fx.deEsser.frequencyHz}
              level={(fx.deEsser.thresholdDb + 60) / 60}
              reductionDb={fx.deEsser.enabled ? reduction("deEsserDb") : 0}
              onDrag={(x, y) =>
                actions.setEffect("deEsser", {
                  frequencyHz: clamp(Math.round(posFreq(x) / 100) * 100, 3000, 10000),
                  thresholdDb: clamp(Math.round(y * 60 - 60), -60, 0),
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
            size="lg"
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
            size="lg"
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
          enabled={fx.exciter.enabled}
          onToggle={(enabled) => actions.setEffect("exciter", { enabled })}
          display={
            <BandDisplay
              frequencyHz={fx.exciter.frequencyHz}
              level={fx.exciter.amount}
              fill={fx.exciter.amount * 0.9}
              onDrag={(x, y) =>
                actions.setEffect("exciter", {
                  frequencyHz: clamp(Math.round(posFreq(x) / 100) * 100, 1000, 8000),
                  amount: clamp(Math.round((y / 0.9) * 100) / 100, 0, 1),
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
            size="lg"
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
            size="lg"
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
          enabled={fx.limiter.enabled}
          onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
          display={
            <>
              <div className="absolute inset-y-0 right-5 left-0">
                <LevelDisplay
                  title={t("effects.ceiling")}
                  lineDb={fx.limiter.ceilingDb}
                  min={-20}
                  max={0}
                  onLine={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
                />
              </div>
              <ReductionBar db={fx.limiter.enabled ? reduction("limiterDb") : 0} max={12} />
            </>
          }
        >
          <Knob
            label={t("effects.ceiling")}
            value={fx.limiter.ceilingDb}
            min={-20}
            max={0}
            step={0.5}
            reset={-3}
            size="lg"
            format={db}
            onChange={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
          />
        </Module>
      );
    default:
      return <PluginsPanel embedded />;
  }
}

const OPEN_KEY = "ode.effects-open";
const DEVICES = ["gate", "denoise", "eq", "agc", "compressor", "deEsser", "exciter", "limiter"] as const;

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) ?? "gate";
  } catch {
    return "gate";
  }
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const plugin = usePlugins((s) => s.status);
  const [stored, setStored] = useState(readOpen);
  const valid: string[] = [...DEVICES, ...(plugin.available ? ["plugin"] : [])];
  const open = valid.includes(stored) ? stored : "gate";
  useEffect(() => {
    void plugins.refresh();
  }, []);
  const select = (id: string) => {
    setStored(id);
    try {
      localStorage.setItem(OPEN_KEY, id);
    } catch {
      // Nur Komfort.
    }
  };
  const item = (id: (typeof DEVICES)[number]) => ({
    id,
    title: t(`effects.${id}`),
    enabled: fx[id].enabled,
    onToggle: (enabled: boolean) => actions.setEffect(id, { enabled }),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <Bench
        open={open}
        onOpen={select}
        items={[
          { group: t("effects.cleanPage") },
          item("gate"),
          item("denoise"),
          item("eq"),
          item("agc"),
          { group: t("effects.dynamicsPage") },
          item("compressor"),
          item("deEsser"),
          item("exciter"),
          item("limiter"),
          ...(plugin.available
            ? [
                { group: t("plugins.page") },
                {
                  id: "plugin",
                  title: plugin.loaded?.name ?? t("plugins.emptyTitle"),
                  enabled: !!plugin.loaded && !plugin.bypass,
                  onToggle: plugin.loaded ? (on: boolean) => void plugins.setBypass(!on) : undefined,
                },
              ]
            : []),
        ]}
      >
        <Device id={open} />
      </Bench>
    </div>
  );
}
