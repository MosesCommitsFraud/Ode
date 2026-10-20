import { useEffect, useRef, useState } from "react";
import { EqDisplay, GridLine, Module, PageBar, PLOT, Reading, Tick, freqX } from "~/components/effects/rack";
import { Knob, Lever, Needle } from "~/components/ui/knob";
import { Bars, LedBar, cssColor } from "~/components/ui/canvas";
import { Pill, PillGroup } from "~/components/ui/pills";
import { actions, useStore } from "~/lib/store";
import { formatDb, gainToDb } from "~/lib/utils";
import { t } from "~/lib/i18n";

/* Die Aufbereitung des Mikrofons als Rack auf zwei Seiten: erst säubern
   (Gate, Rauschfilter, EQ, Auto-Lautstärke), dann Dynamik (Kompressor,
   De-Esser, Exciter, Limiter). Jedes Modul zeigt, was es gerade tut. */

const GATE_FLOOR = -80;

/** Pegel des Mikrofons gegen die Schwelle des Gates. */
function GateDisplay({ peak, thresholdDb, open }: { peak: number; thresholdDb: number; open: boolean }) {
  const display = useRef(GATE_FLOOR);
  const db = gainToDb(peak, GATE_FLOOR);
  display.current = Math.max(db, display.current - 2);
  const level = (display.current - GATE_FLOOR) / -GATE_FLOOR;
  const threshold = (thresholdDb - GATE_FLOOR) / -GATE_FLOOR;

  return (
    <div className="absolute inset-0 flex items-center px-4">
      <LedBar
        segment={2}
        color={(pos) => (pos > level ? "off" : open ? "on" : "dim")}
        deps={[level, open]}
        className="h-10 w-full [--ch:var(--ch-mic)]"
      />
      <div
        className="absolute top-1/2 h-14 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `calc(1rem + (100% - 2rem) * ${threshold})` }}
      />
    </div>
  );
}

/** 60 Schritte zu 150 ms ≈ 9 s Verlauf. */
const HISTORY = 60;
const STEP_MS = 150;

/**
 * Verlauf der Spracherkennung als feine Balken. Läuft in festem Takt, egal wie
 * oft die Seite neu zeichnet; pro Takt zählt der Höchstwert, damit kurze Laute
 * nicht verloren gehen.
 */
function VoiceDisplay({ voice, enabled }: { voice: number; enabled: boolean }) {
  const peak = useRef(0);
  peak.current = Math.max(peak.current, enabled ? voice : 0);
  const [history, setHistory] = useState<number[]>(() => Array(HISTORY).fill(0));
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = peak.current;
      peak.current = 0;
      setHistory((h) => [...h.slice(1), v]);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 p-3">
      <Bars
        values={history}
        align="bottom"
        stretch
        bar={2}
        gap={1}
        min={0.03}
        color={(_, v, el) =>
          v > 0.6 ? [cssColor(el, "--success"), 1] : [cssColor(el, "--muted-foreground"), 0.35]
        }
        deps={[history]}
        className="size-full"
      />
    </div>
  );
}

const COMP_RANGE = 60;
const COMP_TICKS = [-60, -40, -20, 0];

/** Kennlinie: Eingang (unten) gegen Ausgang (links), oberhalb der Schwelle flacher. */
function CompressorDisplay({ thresholdDb, ratio, makeupDb }: { thresholdDb: number; ratio: number; makeupDb: number }) {
  const map = (db: number) => ((db + COMP_RANGE) / COMP_RANGE) * 100;
  const out = (db: number) => (db < thresholdDb ? db : thresholdDb + (db - thresholdDb) / ratio) + makeupDb;
  const pts = [-COMP_RANGE, thresholdDb, 0].map((db) => `${map(db)},${100 - map(Math.min(0, out(db)))}`).join(" ");
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {COMP_TICKS.map((db) => (
            <g key={db}>
              <GridLine x={map(db)} />
              <GridLine y={100 - map(db)} />
            </g>
          ))}
          <line x1="0" y1="100" x2="100" y2="0" stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={map(thresholdDb)} x2={map(thresholdDb)} y1="0" y2="100" stroke="var(--ch-mic)" strokeOpacity=".45" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <polyline points={pts} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="pointer-events-none absolute top-3 bottom-6 left-0 w-9">
        {COMP_TICKS.map((db) => (
          <Tick key={db} axis="y" at={100 - map(db)}>
            {db}
          </Tick>
        ))}
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {COMP_TICKS.map((db) => (
          <Tick key={db} axis="x" at={map(db)}>
            {db}
          </Tick>
        ))}
      </div>
    </>
  );
}

/** Zeigerinstrument für die automatische Lautstärke: Mitte = 0 dB. */
function AgcDisplay({ gainDb, maxGainDb }: { gainDb: number; maxGainDb: number }) {
  const range = Math.max(6, maxGainDb);
  const ticks = [-range, -range / 2, 0, range / 2, range].map((t) => Math.round(t));
  return (
    <Needle
      className="absolute inset-2"
      value={0.5 + gainDb / range / 2}
      label="GAIN dB"
      scale={ticks.map((t) => [0.5 + t / range / 2, t > 0 ? `+${t}` : String(t)])}
    />
  );
}

/** Zeigerinstrument für die Absenkung: Ruhe rechts bei 0, Ausschlag nach links. */
function ReductionDisplay({ db, max }: { db: number; max: number }) {
  const ticks = [0, -3, -6, -9, -12, -18].filter((t) => -t <= max);
  return (
    <Needle
      className="absolute inset-2"
      value={1 - Math.min(1, Math.max(0, -db / max))}
      label="GR dB"
      scale={ticks.map((t) => [1 + t / max, String(t)])}
    />
  );
}

const SPECTRUM_TICKS: [number, string][] = [
  [100, "100"],
  [1000, "1k"],
  [5000, "5k"],
  [15000, "15k"],
];

/** Bereich ab der Trennfrequenz als Fläche, darin die aktuelle Absenkung bzw. Anhebung. */
function HighBandDisplay({ frequencyHz, db, max }: { frequencyHz: number; db: number; max: number }) {
  const x = freqX(frequencyHz);
  const y = 50 - (Math.max(-max, Math.min(max, db)) / max) * 45;
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {SPECTRUM_TICKS.map(([f]) => (
            <GridLine key={f} x={freqX(f)} />
          ))}
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
          <line x1={x} x2={x} y1="0" y2="100" stroke="var(--ch-mic)" strokeOpacity=".45" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {SPECTRUM_TICKS.map(([f, label]) => (
          <Tick key={f} axis="x" at={freqX(f)}>
            {label}
          </Tick>
        ))}
      </div>
    </>
  );
}

const PAGE_KEY = "ode.effects-page";
type Page = "clean" | "dynamics";

function readPage(): Page {
  try {
    return localStorage.getItem(PAGE_KEY) === "dynamics" ? "dynamics" : "clean";
  } catch {
    return "clean";
  }
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const micPeak = useStore((s) => s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0);
  const running = useStore((s) => s.info !== null);
  const [page, setPageState] = useState<Page>(readPage);
  const setPage = (next: Page) => {
    setPageState(next);
    try {
      localStorage.setItem(PAGE_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };

  const compressorDb = running ? (live?.compressorDb ?? 0) : 0;
  const deEsserDb = running ? (live?.deEsserDb ?? 0) : 0;
  const limiterDb = running ? (live?.limiterDb ?? 0) : 0;
  const voice = running ? (live?.voice ?? 0) : 0;
  const voiceOpen = fx.denoise.voiceGate ? !!live?.voiceOpen : voice > 0.6;
  const agcGainDb = running ? (live?.agcGainDb ?? 0) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageBar>
        <PillGroup>
          <Pill active={page === "clean"} onClick={() => setPage("clean")}>
            {t("effects.cleanPage")}
          </Pill>
          <Pill active={page === "dynamics"} onClick={() => setPage("dynamics")}>
            {t("effects.dynamicsPage")}
          </Pill>
        </PillGroup>
      </PageBar>

      <div
        key={page}
        className="grid min-h-0 flex-1 animate-[layout-in_260ms_var(--ease-drawer)] grid-cols-2 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 pr-3 pb-3 pl-6"
      >
        {page === "clean" ? (
          <>
            <Module
              title={t("effects.gate")}
              enabled={fx.gate.enabled}
              onToggle={(enabled) => actions.setEffect("gate", { enabled })}
              status={
                fx.gate.enabled &&
                running && <Reading tone={live?.gateOpen ? "success" : "default"}>{live?.gateOpen ? t("effects.open") : t("effects.closed")}</Reading>
              }
              display={
                <GateDisplay peak={running ? micPeak : 0} thresholdDb={fx.gate.thresholdDb} open={!fx.gate.enabled || !!live?.gateOpen} />
              }
            >
              <Knob
                label={t("effects.threshold")}
                value={fx.gate.thresholdDb}
                min={-80}
                max={-10}
                step={1}
                reset={-50}
                format={(v) => `${v} dB`}
                disabled={!fx.gate.enabled}
                onChange={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
              />
            </Module>

            <Module
              title={t("effects.denoise")}
              enabled={fx.denoise.enabled}
              onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
              status={
                fx.denoise.enabled &&
                running && (
                  <Reading tone={voiceOpen ? "success" : "default"}>
                    {voiceOpen ? t("effects.voice") : fx.denoise.voiceGate ? t("effects.blocked") : t("effects.quiet")}
                  </Reading>
                )
              }
              display={<VoiceDisplay voice={voice} enabled={fx.denoise.enabled} />}
            >
              <Lever
                label={t("effects.voiceGate")}
                checked={fx.denoise.voiceGate}
                disabled={!fx.denoise.enabled}
                on={t("voice.leverOn")}
                off={t("voice.leverOff")}
                onChange={(voiceGate) => actions.setEffect("denoise", { voiceGate })}
              />
            </Module>

            <Module
              title={t("effects.eq")}
              columns={3}
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
                <Knob
                  key={key}
                  label={label}
                  value={fx.eq[key]}
                  min={-12}
                  max={12}
                  step={0.5}
                  bipolar
                  format={(v) => `${formatDb(v)} dB`}
                  disabled={!fx.eq.enabled}
                  onChange={(v) => actions.setEffect("eq", { [key]: v })}
                />
              ))}
            </Module>

            <Module
              title={t("effects.agc")}
              columns={2}
              enabled={fx.agc.enabled}
              onToggle={(enabled) => actions.setEffect("agc", { enabled })}
              status={
                fx.agc.enabled &&
                running && <Reading tone={Math.abs(agcGainDb) > 0.5 ? "warning" : "default"}>{`${formatDb(agcGainDb)} dB`}</Reading>
              }
              display={<AgcDisplay gainDb={agcGainDb} maxGainDb={fx.agc.maxGainDb} />}
            >
              <Knob
                label={t("effects.target")}
                value={fx.agc.targetDb}
                min={-30}
                max={-10}
                step={1}
                reset={-20}
                format={(v) => `${v} dB`}
                disabled={!fx.agc.enabled}
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
                disabled={!fx.agc.enabled}
                onChange={(maxGainDb) => actions.setEffect("agc", { maxGainDb })}
              />
            </Module>
          </>
        ) : (
          <>
            <Module
              title={t("effects.compressor")}
              columns={3}
              enabled={fx.compressor.enabled}
              onToggle={(enabled) => actions.setEffect("compressor", { enabled })}
              status={
                fx.compressor.enabled &&
                running && (
                  <Reading tone={compressorDb < -0.5 ? "warning" : "default"}>
                    {compressorDb < -0.05 ? `${compressorDb.toFixed(1)} dB` : "—"}
                  </Reading>
                )
              }
              display={<CompressorDisplay thresholdDb={fx.compressor.thresholdDb} ratio={fx.compressor.ratio} makeupDb={fx.compressor.makeupDb} />}
            >
              <Knob
                label={t("effects.threshold")}
                value={fx.compressor.thresholdDb}
                min={-50}
                max={0}
                step={1}
                reset={-20}
                format={(v) => `${v} dB`}
                disabled={!fx.compressor.enabled}
                onChange={(thresholdDb) => actions.setEffect("compressor", { thresholdDb })}
              />
              <Knob
                label={t("effects.ratio")}
                value={fx.compressor.ratio}
                min={1}
                max={10}
                step={0.5}
                reset={3}
                format={(v) => `${v.toFixed(1)} : 1`}
                disabled={!fx.compressor.enabled}
                onChange={(ratio) => actions.setEffect("compressor", { ratio })}
              />
              <Knob
                label={t("effects.makeup")}
                value={fx.compressor.makeupDb}
                min={0}
                max={18}
                step={0.5}
                reset={4}
                format={(v) => `+${v.toFixed(1)} dB`}
                disabled={!fx.compressor.enabled}
                onChange={(makeupDb) => actions.setEffect("compressor", { makeupDb })}
              />
            </Module>

            <Module
              title={t("effects.deEsser")}
              columns={2}
              enabled={fx.deEsser.enabled}
              onToggle={(enabled) => actions.setEffect("deEsser", { enabled })}
              status={
                fx.deEsser.enabled &&
                running && (
                  <Reading tone={deEsserDb < -0.5 ? "warning" : "default"}>{deEsserDb < -0.05 ? `${deEsserDb.toFixed(1)} dB` : "—"}</Reading>
                )
              }
              display={<HighBandDisplay frequencyHz={fx.deEsser.frequencyHz} db={fx.deEsser.enabled ? deEsserDb : 0} max={18} />}
            >
              <Knob
                label={t("effects.threshold")}
                value={fx.deEsser.thresholdDb}
                min={-60}
                max={0}
                step={1}
                reset={-30}
                format={(v) => `${v} dB`}
                disabled={!fx.deEsser.enabled}
                onChange={(thresholdDb) => actions.setEffect("deEsser", { thresholdDb })}
              />
              <Knob
                label={t("effects.frequency")}
                value={fx.deEsser.frequencyHz}
                min={3000}
                max={10000}
                step={100}
                reset={6000}
                format={(v) => `${(v / 1000).toFixed(1)} kHz`}
                disabled={!fx.deEsser.enabled}
                onChange={(frequencyHz) => actions.setEffect("deEsser", { frequencyHz })}
              />
            </Module>

            <Module
              title={t("effects.exciter")}
              columns={2}
              enabled={fx.exciter.enabled}
              onToggle={(enabled) => actions.setEffect("exciter", { enabled })}
              display={<HighBandDisplay frequencyHz={fx.exciter.frequencyHz} db={fx.exciter.amount * 9} max={12} />}
            >
              <Knob
                label={t("effects.frequency")}
                value={fx.exciter.frequencyHz}
                min={1000}
                max={8000}
                step={100}
                reset={3000}
                format={(v) => `${(v / 1000).toFixed(1)} kHz`}
                disabled={!fx.exciter.enabled}
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
                disabled={!fx.exciter.enabled}
                onChange={(amount) => actions.setEffect("exciter", { amount })}
              />
            </Module>

            <Module
              title={t("effects.limiter")}
              enabled={fx.limiter.enabled}
              onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
              status={
                fx.limiter.enabled &&
                running && (
                  <Reading tone={limiterDb < -0.5 ? "warning" : "default"}>{limiterDb < -0.05 ? `${limiterDb.toFixed(1)} dB` : "—"}</Reading>
                )
              }
              display={<ReductionDisplay db={limiterDb} max={12} />}
            >
              <Knob
                label={t("effects.ceiling")}
                value={fx.limiter.ceilingDb}
                min={-20}
                max={0}
                step={0.5}
                reset={-3}
                format={(v) => `${formatDb(v)} dB`}
                disabled={!fx.limiter.enabled}
                onChange={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
              />
            </Module>
          </>
        )}
      </div>
    </div>
  );
}

