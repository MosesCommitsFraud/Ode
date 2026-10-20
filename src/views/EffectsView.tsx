import { useEffect, useRef, useState } from "react";
import { PluginsPanel } from "~/components/effects/PluginsPanel";
import { Console, EqDisplay, GridLine, Module, PLOT, Tick, freqX } from "~/components/effects/rack";
import { StripToggle } from "~/components/mixer/ChannelStrip";
import { Bars, cssColor } from "~/components/ui/canvas";
import { PushButtons, SlideFader } from "~/components/ui/hardware";
import { Needle } from "~/components/ui/knob";
import { Pill, PillGroup } from "~/components/ui/pills";
import { actions, useStore } from "~/lib/store";
import { formatDb, gainToDb } from "~/lib/utils";
import { t } from "~/lib/i18n";
import { plugins, usePlugins } from "~/lib/plugins";

/* Die Aufbereitung des Mikrofons als Pult wie im Mischpult: vier Züge je
   Seite, erst säubern (Gate, Rauschfilter, EQ, Auto-Lautstärke), dann Dynamik
   (Kompressor, De-Esser, Exciter, Limiter). Jedes Gerät zeigt als Bild, was
   es gerade tut, ohne Messwerte zum Deuten. */

const db = (v: number) => `${formatDb(v)} dB`;
const kHz = (v: number) => `${(v / 1000).toFixed(1)} kHz`;

/** 60 Schritte zu 120 ms ≈ 7 s Verlauf. */
const HISTORY = 60;
const STEP_MS = 120;

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

const GATE_FLOOR = -70;

/** Pegel als Verlauf mit der Schwelle als Linie: was darunter liegt, bleibt stumm. */
function GateDisplay({ peak, thresholdDb }: { peak: number; thresholdDb: number }) {
  const pos = (v: number) => Math.min(1, Math.max(0, (v - GATE_FLOOR) / -GATE_FLOOR));
  const history = useHistory(pos(gainToDb(peak, GATE_FLOOR)));
  const line = pos(thresholdDb);
  return (
    <div className="absolute inset-3">
      <Bars
        values={history}
        align="bottom"
        stretch
        bar={2}
        gap={1}
        min={0.02}
        color={(_, v, el) => (v > line ? [cssColor(el, "--ch-mic"), 1] : [cssColor(el, "--muted-foreground"), 0.3])}
        deps={[history, line]}
        className="size-full"
      />
      <div className="absolute inset-x-0 border-t-2 border-dashed border-[var(--ch-mic)]" style={{ bottom: `${line * 100}%` }} />
    </div>
  );
}

/** Verlauf der Spracherkennung: Sprache grün, alles andere grau. */
function VoiceDisplay({ voice }: { voice: number }) {
  const history = useHistory(voice);
  return (
    <div className="absolute inset-3">
      <Bars
        values={history}
        align="bottom"
        stretch
        bar={2}
        gap={1}
        min={0.03}
        color={(_, v, el) => (v > 0.6 ? [cssColor(el, "--success"), 1] : [cssColor(el, "--muted-foreground"), 0.3])}
        deps={[history]}
        className="size-full"
      />
    </div>
  );
}

/** Zeigerinstrument für die automatische Lautstärke: Mitte = unverändert. */
function AgcDisplay({ gainDb, maxGainDb }: { gainDb: number; maxGainDb: number }) {
  const range = Math.max(6, maxGainDb);
  return <Needle className="absolute inset-2" value={0.5 + gainDb / range / 2} scale={[[0, "−"], [0.5, "0"], [1, "+"]]} />;
}

/** Zeigerinstrument für die Absenkung: Ruhe rechts, je mehr das Gerät eingreift, desto weiter links. */
function ReductionDisplay({ db, max }: { db: number; max: number }) {
  return <Needle className="absolute inset-2" value={1 - Math.min(1, Math.max(0, -db / max))} scale={[[0, "−"], [1, "0"]]} />;
}

/** Bereich ab der Trennfrequenz als Fläche mit der aktuellen Anhebung. */
function HighBandDisplay({ frequencyHz, db: level, max }: { frequencyHz: number; db: number; max: number }) {
  const x = freqX(frequencyHz);
  const y = 50 - (Math.max(-max, Math.min(max, level)) / max) * 45;
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          <GridLine y={50} strong />
          <rect x={x} y={Math.min(50, y)} width={100 - x} height={Math.abs(50 - y)} fill="var(--ch-mic)" fillOpacity=".2" />
          <polyline
            points={`0,50 ${Math.max(0, x - 6)},50 ${x},${y} 100,${y}`}
            fill="none"
            stroke="var(--ch-mic)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-3 h-6">
        <Tick axis="x" at={freqX(90)}>
          {t("effects.bass")}
        </Tick>
        <Tick axis="x" at={freqX(9000)}>
          {t("effects.treble")}
        </Tick>
      </div>
    </>
  );
}

const RATIOS: { value: number; label: string }[] = [
  { value: 2, label: "effects.ratioSoft" },
  { value: 4, label: "effects.ratioMedium" },
  { value: 8, label: "effects.ratioHard" },
];

type Page = "clean" | "dynamics" | "plugin";
const PAGE_KEY = "ode.effects-page";

function readPage(): Page {
  try {
    const stored = localStorage.getItem(PAGE_KEY);
    return stored === "dynamics" || stored === "plugin" ? stored : "clean";
  } catch {
    return "clean";
  }
}

function CleanPage() {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const running = useStore((s) => s.info !== null);
  const micPeak = useStore((s) => s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0);
  const voice = running && fx.denoise.enabled ? (live?.voice ?? 0) : 0;
  const agcGainDb = running ? (live?.agcGainDb ?? 0) : 0;

  return (
    <Console>
      <Module
        title={t("effects.gate")}
        help="gate"
        enabled={fx.gate.enabled}
        onToggle={(enabled) => actions.setEffect("gate", { enabled })}
        display={<GateDisplay peak={running ? micPeak : 0} thresholdDb={fx.gate.thresholdDb} />}
      >
        <SlideFader
          label={t("effects.threshold")}
          value={fx.gate.thresholdDb}
          min={GATE_FLOOR}
          max={-10}
          step={1}
          reset={-50}
          format={db}
          onChange={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
        />
      </Module>

      <Module
        title={t("effects.denoise")}
        help="denoise"
        enabled={fx.denoise.enabled}
        onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
        display={<VoiceDisplay voice={voice} />}
        extra={
          <StripToggle title={t("effects.voiceGate")} on={fx.denoise.voiceGate} onClick={() => actions.setEffect("denoise", { voiceGate: !fx.denoise.voiceGate })}>
            {t("effects.voiceGateLabel")}
          </StripToggle>
        }
      />

      <Module
        title={t("effects.eq")}
        help="eq"
        enabled={fx.eq.enabled}
        onToggle={(enabled) => actions.setEffect("eq", { enabled })}
        display={<EqDisplay low={fx.eq.lowDb} mid={fx.eq.midDb} high={fx.eq.highDb} />}
      >
        {(
          [
            ["lowDb", t("effects.bass")],
            ["midDb", t("effects.presence")],
            ["highDb", t("effects.treble")],
          ] as const
        ).map(([key, label]) => (
          <SlideFader
            key={key}
            label={label}
            value={fx.eq[key]}
            min={-12}
            max={12}
            step={0.5}
            reset={0}
            bipolar
            format={db}
            onChange={(v) => actions.setEffect("eq", { [key]: v })}
          />
        ))}
      </Module>

      <Module
        title={t("effects.agc")}
        help="agc"
        enabled={fx.agc.enabled}
        onToggle={(enabled) => actions.setEffect("agc", { enabled })}
        display={<AgcDisplay gainDb={agcGainDb} maxGainDb={fx.agc.maxGainDb} />}
      >
        <SlideFader
          label={t("effects.target")}
          value={fx.agc.targetDb}
          min={-30}
          max={-10}
          step={1}
          reset={-20}
          format={db}
          onChange={(targetDb) => actions.setEffect("agc", { targetDb })}
        />
        <SlideFader
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
    </Console>
  );
}

function DynamicsPage() {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const running = useStore((s) => s.info !== null);
  const compressorDb = running && fx.compressor.enabled ? (live?.compressorDb ?? 0) : 0;
  const deEsserDb = running && fx.deEsser.enabled ? (live?.deEsserDb ?? 0) : 0;
  const limiterDb = running && fx.limiter.enabled ? (live?.limiterDb ?? 0) : 0;

  return (
    <Console>
      <Module
        title={t("effects.compressor")}
        help="compressor"
        enabled={fx.compressor.enabled}
        onToggle={(enabled) => actions.setEffect("compressor", { enabled })}
        display={<ReductionDisplay db={compressorDb} max={18} />}
        keys={
          <PushButtons
            value={RATIOS.reduce((best, r) => (Math.abs(r.value - fx.compressor.ratio) < Math.abs(best - fx.compressor.ratio) ? r.value : best), 4)}
            options={RATIOS.map((r) => ({ value: r.value, label: t(r.label), title: `${r.value}:1` }))}
            onChange={(ratio) => actions.setEffect("compressor", { ratio })}
          />
        }
      >
        <SlideFader
          label={t("effects.threshold")}
          value={fx.compressor.thresholdDb}
          min={-50}
          max={0}
          step={1}
          reset={-20}
          format={db}
          onChange={(thresholdDb) => actions.setEffect("compressor", { thresholdDb })}
        />
        <SlideFader
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

      <Module
        title={t("effects.deEsser")}
        help="deEsser"
        enabled={fx.deEsser.enabled}
        onToggle={(enabled) => actions.setEffect("deEsser", { enabled })}
        display={<ReductionDisplay db={deEsserDb} max={18} />}
      >
        <SlideFader
          label={t("effects.threshold")}
          value={fx.deEsser.thresholdDb}
          min={-60}
          max={0}
          step={1}
          reset={-30}
          format={db}
          onChange={(thresholdDb) => actions.setEffect("deEsser", { thresholdDb })}
        />
        <SlideFader
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

      <Module
        title={t("effects.exciter")}
        help="exciter"
        enabled={fx.exciter.enabled}
        onToggle={(enabled) => actions.setEffect("exciter", { enabled })}
        display={<HighBandDisplay frequencyHz={fx.exciter.frequencyHz} db={fx.exciter.amount * 9} max={12} />}
      >
        <SlideFader
          label={t("effects.frequency")}
          value={fx.exciter.frequencyHz}
          min={1000}
          max={8000}
          step={100}
          reset={3000}
          format={kHz}
          onChange={(frequencyHz) => actions.setEffect("exciter", { frequencyHz })}
        />
        <SlideFader
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

      <Module
        title={t("effects.limiter")}
        help="limiter"
        enabled={fx.limiter.enabled}
        onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
        display={<ReductionDisplay db={limiterDb} max={12} />}
      >
        <SlideFader
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
    </Console>
  );
}

export function EffectsView() {
  const pluginsAvailable = usePlugins((s) => s.status.available);
  const [stored, setStored] = useState<Page>(readPage);
  const page = stored === "plugin" && !pluginsAvailable ? "clean" : stored;
  useEffect(() => {
    void plugins.refresh();
  }, []);
  const setPage = (next: Page) => {
    setStored(next);
    try {
      localStorage.setItem(PAGE_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <div className="flex shrink-0 items-center gap-2">
        <PillGroup>
          <Pill active={page === "clean"} onClick={() => setPage("clean")}>
            {t("effects.cleanPage")}
          </Pill>
          <Pill active={page === "dynamics"} onClick={() => setPage("dynamics")}>
            {t("effects.dynamicsPage")}
          </Pill>
          {pluginsAvailable && (
            <Pill active={page === "plugin"} onClick={() => setPage("plugin")}>
              {t("plugins.page")}
            </Pill>
          )}
        </PillGroup>
      </div>
      {page === "clean" && <CleanPage />}
      {page === "dynamics" && <DynamicsPage />}
      {page === "plugin" && <PluginsPanel embedded />}
    </div>
  );
}
