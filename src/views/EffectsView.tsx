import { useRef, type ReactNode } from "react";
import { Badge, Card, Switch } from "~/components/ui/misc";
import { actions, useStore } from "~/lib/store";
import { cn, formatDb, gainToDb } from "~/lib/utils";

/* Die Mikrofon-Kette als Rack: fünf Module nebeneinander, jedes mit einer
   Anzeige, die zeigt, was der Effekt gerade tut, und den Reglern darunter. */

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  reset = 0,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Wert für Doppelklick. */
  reset?: number;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={cn("block space-y-1.5", disabled && "opacity-45")}>
      <div className="flex flex-wrap justify-between gap-x-2 text-2xs">
        <span className="whitespace-nowrap text-muted-foreground">{label}</span>
        <span className="ml-auto font-mono whitespace-nowrap tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(Math.min(max, Math.max(min, reset)))}
        className="h-1.5 w-full cursor-default appearance-none rounded-full [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_3px_oklch(0%_0_0/45%)]"
        style={{ background: `linear-gradient(to right, var(--ch-mic) ${fill}%, var(--meter-track) 0)` }}
      />
    </label>
  );
}

/** Ein Effekt als Karte: Kopf mit Schalter, große Anzeige, Regler nebeneinander darunter. */
function Module({
  title,
  enabled,
  onToggle,
  status,
  display,
  className,
  inline,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  status?: ReactNode;
  display: ReactNode;
  className?: string;
  /** Regler nebeneinander statt untereinander, damit die Anzeige Platz behält. */
  inline?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className={cn("flex min-h-0 min-w-0 flex-col gap-3 p-4", className)}>
      <div className="flex h-7 items-center gap-3">
        <Switch label={title} checked={enabled} onCheckedChange={onToggle} />
        <h3 className="min-w-0 flex-1 truncate font-display text-base font-semibold tracking-tight">{title}</h3>
        {status}
      </div>
      <div className={cn("well relative min-h-0 flex-1 overflow-hidden rounded-xl transition-opacity", !enabled && "opacity-40")}>
        {display}
      </div>
      {children && <div className={inline ? "grid grid-flow-col auto-cols-fr gap-3" : "space-y-2.5"}>{children}</div>}
    </Card>
  );
}

/* ---------- Anzeigen ---------- */

const GATE_FLOOR = -80;
/** Feine LED-Streben wie bei den Pegeln im Mischpult. */
const SEGMENTS = "repeating-linear-gradient(to right, #000 0 2px, transparent 2px 4px)";

/** Beschriftung einer Achse; `at` ist die Position in Prozent. */
function Tick({ at, axis, children }: { at: number; axis: "x" | "y"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute font-mono text-[9px] leading-none text-muted-foreground/70 tabular-nums",
        axis === "x" ? "bottom-1.5 -translate-x-1/2" : "left-2 -translate-y-1/2",
      )}
      style={axis === "x" ? { left: `${at}%` } : { top: `${at}%` }}
    >
      {children}
    </span>
  );
}

/** Pegel des Mikrofons gegen die Schwelle des Gates. */
function GateDisplay({ peak, thresholdDb, open }: { peak: number; thresholdDb: number; open: boolean }) {
  const display = useRef(GATE_FLOOR);
  const db = gainToDb(peak, GATE_FLOOR);
  display.current = Math.max(db, display.current - 2);
  const level = (display.current - GATE_FLOOR) / -GATE_FLOOR;
  const threshold = (thresholdDb - GATE_FLOOR) / -GATE_FLOOR;

  return (
    <div className="absolute inset-0 flex items-center px-4">
      <div className="relative h-10 w-full" style={{ maskImage: SEGMENTS, WebkitMaskImage: SEGMENTS }}>
        <div className="absolute inset-0 bg-[var(--led-off)]" />
        <div
          className={cn("absolute inset-y-0 left-0", open ? "bg-[var(--ch-mic)]" : "bg-muted-foreground/40")}
          style={{ width: `${level * 100}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 h-14 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `calc(1rem + (100% - 2rem) * ${threshold})` }}
      />
    </div>
  );
}

const HISTORY = 90;

/** Verlauf der Spracherkennung der letzten Sekunden als feine Balken. */
function VoiceDisplay({ voice, enabled }: { voice: number; enabled: boolean }) {
  const history = useRef<number[]>(Array(HISTORY).fill(0));
  history.current = [...history.current.slice(1), enabled ? voice : 0];
  return (
    <div className="absolute inset-0 flex items-end gap-[2px] p-3">
      {history.current.map((v, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-[1px]", v > 0.6 ? "bg-success" : "bg-muted-foreground/30")}
          style={{ height: `${Math.max(3, v * 100)}%` }}
        />
      ))}
    </div>
  );
}

/* Zeichenfläche für Kurven mit Platz für die Achsen links und unten. */
const PLOT = "absolute top-3 right-3 bottom-6 left-9";

const EQ_RANGE = 15;
const EQ_DB_TICKS = [12, 6, 0, -6, -12];
const EQ_FREQ_TICKS: [number, string][] = [
  [50, "50"],
  [200, "200"],
  [1000, "1k"],
  [5000, "5k"],
  [15000, "15k"],
];

/** Frequenzgang aus Tiefen-Shelf, Präsenz-Glocke und Höhen-Shelf, grob angenähert. */
function EqDisplay({ low, mid, high }: { low: number; mid: number; high: number }) {
  const points: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const x = i / 80;
    const f = 20 * Math.pow(1000, x); // 20 Hz … 20 kHz, logarithmisch
    const lf = Math.log2(f);
    const shelfLow = low / (1 + Math.pow(2, (lf - Math.log2(120)) * 2));
    const shelfHigh = high / (1 + Math.pow(2, (Math.log2(8000) - lf) * 2));
    const bell = mid * Math.exp(-Math.pow(lf - Math.log2(2500), 2) / 1.2);
    const db = shelfLow + shelfHigh + bell;
    points.push(`${x * 100},${50 - (db / EQ_RANGE) * 50}`);
  }
  const line = points.join(" ");
  const fx = (f: number) => (Math.log10(f / 20) / 3) * 100;
  const dy = (db: number) => 50 - (db / EQ_RANGE) * 50;

  return (
    <>
      <div className={PLOT}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
        {EQ_FREQ_TICKS.map(([f]) => (
          <line key={f} x1={fx(f)} x2={fx(f)} y1="0" y2="100" stroke="var(--muted-foreground)" strokeOpacity=".15" vectorEffect="non-scaling-stroke" />
        ))}
        {EQ_DB_TICKS.map((db) => (
          <line
            key={db}
            x1="0"
            x2="100"
            y1={dy(db)}
            y2={dy(db)}
            stroke="var(--muted-foreground)"
            strokeOpacity={db === 0 ? ".4" : ".12"}
            strokeDasharray={db === 0 ? "3 3" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon points={`0,50 ${line} 100,50`} fill="var(--ch-mic)" fillOpacity=".16" />
        <polyline points={line} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      </div>
      <div className="pointer-events-none absolute top-3 bottom-6 left-0 w-9">
        {EQ_DB_TICKS.map((db) => (
          <Tick key={db} axis="y" at={dy(db)}>
            {db > 0 ? `+${db}` : db}
          </Tick>
        ))}
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {EQ_FREQ_TICKS.map(([f, label]) => (
          <Tick key={f} axis="x" at={fx(f)}>
            {label}
          </Tick>
        ))}
      </div>
    </>
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
          <g key={db} stroke="var(--muted-foreground)" strokeOpacity=".12">
            <line x1={map(db)} x2={map(db)} y1="0" y2="100" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="100" y1={100 - map(db)} y2={100 - map(db)} vectorEffect="non-scaling-stroke" />
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

/** Aktuelle Anhebung oder Absenkung der automatischen Lautstärke, von der Mitte aus. */
function AgcDisplay({ gainDb, maxGainDb }: { gainDb: number; maxGainDb: number }) {
  const range = Math.max(6, maxGainDb);
  const amount = Math.min(1, Math.abs(gainDb) / range) * 50;
  const ticks = [-range, -range / 2, 0, range / 2, range].map((t) => Math.round(t));
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2 px-4">
      <div className="relative h-10 w-full" style={{ maskImage: SEGMENTS, WebkitMaskImage: SEGMENTS }}>
        <div className="absolute inset-0 bg-[var(--led-off)]" />
        <div
          className={cn("absolute inset-y-0", gainDb >= 0 ? "left-1/2 bg-[var(--ch-mic)]" : "right-1/2 bg-warning")}
          style={{ width: `${amount}%` }}
        />
      </div>
      <div className="absolute top-1/2 left-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-[calc(50%+0.625rem)] rounded-full bg-foreground/60" />
      <div className="relative h-3">
        {ticks.map((t) => (
          <Tick key={t} axis="x" at={50 + (t / range) * 50}>
            {t > 0 ? `+${t}` : t}
          </Tick>
        ))}
      </div>
    </div>
  );
}

const GR_TICKS = [0, -3, -6, -9, -12];

/** Absenkung als Balken von rechts, darunter die Skala in dB. */
function ReductionDisplay({ db, max }: { db: number; max: number }) {
  const amount = Math.min(1, Math.max(0, -db / max));
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2 px-4">
      <div className="relative h-10 w-full" style={{ maskImage: SEGMENTS, WebkitMaskImage: SEGMENTS }}>
        <div className="absolute inset-0 bg-[var(--led-off)]" />
        <div className="absolute inset-y-0 right-0 bg-warning" style={{ width: `${amount * 100}%` }} />
      </div>
      <div className="relative h-3">
        {GR_TICKS.filter((t) => -t <= max).map((t) => (
          <Tick key={t} axis="x" at={100 - (-t / max) * 100}>
            {t}
          </Tick>
        ))}
      </div>
    </div>
  );
}

function Reading({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" }) {
  return <Badge tone={tone}>{children}</Badge>;
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const live = useStore((s) => s.meters?.effects);
  const micPeak = useStore((s) => s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0);
  const running = useStore((s) => s.info !== null);

  const compressorDb = running ? (live?.compressorDb ?? 0) : 0;
  const limiterDb = running ? (live?.limiterDb ?? 0) : 0;
  const voice = running ? (live?.voice ?? 0) : 0;
  const voiceOpen = fx.denoise.voiceGate ? !!live?.voiceOpen : voice > 0.6;
  const agcGainDb = running ? (live?.agcGainDb ?? 0) : 0;

  return (
    <div className="grid h-full grid-cols-6 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden pl-6 pr-3 pt-3 pb-3">
      <Module
        className="col-span-2"
        title="Noise Gate"
        enabled={fx.gate.enabled}
        onToggle={(enabled) => actions.setEffect("gate", { enabled })}
        status={
          fx.gate.enabled &&
          running && <Reading tone={live?.gateOpen ? "success" : "default"}>{live?.gateOpen ? "Offen" : "Zu"}</Reading>
        }
        display={
          <GateDisplay
            peak={running ? micPeak : 0}
            thresholdDb={fx.gate.thresholdDb}
            open={!fx.gate.enabled || !!live?.gateOpen}
          />
        }
      >
        <Range
          label="Schwelle"
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
        className="col-span-2"
        title="Rauschfilter"
        enabled={fx.denoise.enabled}
        onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
        status={
          fx.denoise.enabled &&
          running && (
            <Reading tone={voiceOpen ? "success" : "default"}>{voiceOpen ? "Sprache" : fx.denoise.voiceGate ? "Gesperrt" : "Ruhe"}</Reading>
          )
        }
        display={<VoiceDisplay voice={voice} enabled={fx.denoise.enabled} />}
      >
        <label
          className={cn(
            "flex items-center justify-between gap-3 text-2xs",
            !fx.denoise.enabled && "opacity-45",
          )}
        >
          <span className="text-muted-foreground">Klicks zwischen Wörtern unterdrücken</span>
          <Switch
            label="Sprach-Gate"
            checked={fx.denoise.voiceGate}
            disabled={!fx.denoise.enabled}
            onCheckedChange={(voiceGate) => actions.setEffect("denoise", { voiceGate })}
          />
        </label>
      </Module>

      <Module
        className="col-span-2"
        title="Equalizer"
        inline
        enabled={fx.eq.enabled}
        onToggle={(enabled) => actions.setEffect("eq", { enabled })}
        display={<EqDisplay low={fx.eq.lowDb} mid={fx.eq.midDb} high={fx.eq.highDb} />}
      >
        {(
          [
            ["lowDb", "Bass"],
            ["midDb", "Präsenz"],
            ["highDb", "Höhen"],
          ] as const
        ).map(([key, label]) => (
          <Range
            key={key}
            label={label}
            value={fx.eq[key]}
            min={-12}
            max={12}
            step={0.5}
            format={(v) => `${formatDb(v)} dB`}
            disabled={!fx.eq.enabled}
            onChange={(v) => actions.setEffect("eq", { [key]: v })}
          />
        ))}
      </Module>

      <Module
        className="col-span-2"
        title="Auto-Lautstärke"
        enabled={fx.agc.enabled}
        onToggle={(enabled) => actions.setEffect("agc", { enabled })}
        status={
          fx.agc.enabled &&
          running && (
            <Reading tone={Math.abs(agcGainDb) > 0.5 ? "warning" : "default"}>
              {`${formatDb(agcGainDb)} dB`}
            </Reading>
          )
        }
        display={<AgcDisplay gainDb={agcGainDb} maxGainDb={fx.agc.maxGainDb} />}
      >
        <Range
          label="Ziel"
          value={fx.agc.targetDb}
          min={-30}
          max={-10}
          step={1}
          reset={-20}
          format={(v) => `${v} dB`}
          disabled={!fx.agc.enabled}
          onChange={(targetDb) => actions.setEffect("agc", { targetDb })}
        />
        <Range
          label="Höchstens anheben"
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

      <Module
        className="col-span-2"
        title="Kompressor"
        inline
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
        display={
          <CompressorDisplay
            thresholdDb={fx.compressor.thresholdDb}
            ratio={fx.compressor.ratio}
            makeupDb={fx.compressor.makeupDb}
          />
        }
      >
        <Range
          label="Schwelle"
          value={fx.compressor.thresholdDb}
          min={-50}
          max={0}
          step={1}
          reset={-20}
          format={(v) => `${v} dB`}
          disabled={!fx.compressor.enabled}
          onChange={(thresholdDb) => actions.setEffect("compressor", { thresholdDb })}
        />
        <Range
          label="Verhältnis"
          value={fx.compressor.ratio}
          min={1}
          max={10}
          step={0.5}
          reset={3}
          format={(v) => `${v.toFixed(1)} : 1`}
          disabled={!fx.compressor.enabled}
          onChange={(ratio) => actions.setEffect("compressor", { ratio })}
        />
        <Range
          label="Aufholen"
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
        className="col-span-2"
        title="Limiter"
        enabled={fx.limiter.enabled}
        onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
        status={
          fx.limiter.enabled &&
          running && (
            <Reading tone={limiterDb < -0.5 ? "warning" : "default"}>
              {limiterDb < -0.05 ? `${limiterDb.toFixed(1)} dB` : "—"}
            </Reading>
          )
        }
        display={<ReductionDisplay db={limiterDb} max={12} />}
      >
        <Range
          label="Obergrenze"
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
    </div>
  );
}
