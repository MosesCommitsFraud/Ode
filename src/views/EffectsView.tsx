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
      <div className="flex justify-between gap-2 text-2xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{format(value)}</span>
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

/** Ein Effekt als Zeile im Rack: Name und Schalter, Regler, Anzeige. */
function Module({
  title,
  enabled,
  onToggle,
  status,
  display,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  status?: ReactNode;
  display: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="grid min-h-0 grid-cols-[12rem_minmax(0,1fr)_minmax(12rem,20rem)] items-stretch gap-6 px-5 py-3">
      <div className="flex items-center gap-3">
        <Switch label={title} checked={enabled} onCheckedChange={onToggle} />
        <h3 className="min-w-0 flex-1 truncate font-display text-base leading-tight font-semibold tracking-tight">{title}</h3>
      </div>

      <div className="grid grid-flow-col auto-cols-[minmax(0,13rem)] content-center justify-start gap-8">{children}</div>

      <div className={cn("well relative min-h-0 overflow-hidden rounded-xl transition-opacity", !enabled && "opacity-40")}>
        {display}
        {status && <div className="absolute top-2 right-2">{status}</div>}
      </div>
    </Card>
  );
}

/* ---------- Anzeigen ---------- */

const GATE_FLOOR = -80;
/** LED-Segmente wie bei den Pegeln im Mischpult. */
const SEGMENTS = "repeating-linear-gradient(to right, #000 0 3px, transparent 3px 5px)";

/** Pegel des Mikrofons gegen die Schwelle des Gates. */
function GateDisplay({ peak, thresholdDb, open }: { peak: number; thresholdDb: number; open: boolean }) {
  const display = useRef(GATE_FLOOR);
  const db = gainToDb(peak, GATE_FLOOR);
  display.current = Math.max(db, display.current - 2);
  const level = (display.current - GATE_FLOOR) / -GATE_FLOOR;
  const threshold = (thresholdDb - GATE_FLOOR) / -GATE_FLOOR;

  return (
    <div className="absolute inset-0 flex items-center px-4">
      <div className="relative h-3 w-full" style={{ maskImage: SEGMENTS, WebkitMaskImage: SEGMENTS }}>
        <div className="absolute inset-0 bg-[var(--led-off)]" />
        <div
          className={cn("absolute inset-y-0 left-0", open ? "bg-[var(--ch-mic)]" : "bg-muted-foreground/40")}
          style={{ width: `${level * 100}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `calc(1rem + (100% - 2rem) * ${threshold})` }}
      />
    </div>
  );
}

const HISTORY = 28;

/** Verlauf der Spracherkennung als Balken. */
function VoiceDisplay({ voice, enabled }: { voice: number; enabled: boolean }) {
  const history = useRef<number[]>(Array(HISTORY).fill(0));
  history.current = [...history.current.slice(1), enabled ? voice : 0];
  return (
    <div className="absolute inset-0 flex items-end gap-[3px] p-2.5">
      {history.current.map((v, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-[2px]", v > 0.6 ? "bg-success" : "bg-muted-foreground/35")}
          style={{ height: `${Math.max(4, v * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** Frequenzgang aus Tiefen-Shelf, Präsenz-Glocke und Höhen-Shelf, grob angenähert. */
function EqDisplay({ low, mid, high }: { low: number; mid: number; high: number }) {
  const points: string[] = [];
  const W = 100;
  const H = 60;
  for (let i = 0; i <= 60; i++) {
    const x = i / 60;
    const f = 20 * Math.pow(1000, x); // 20 Hz … 20 kHz, logarithmisch
    const lf = Math.log2(f);
    const shelfLow = low / (1 + Math.pow(2, (lf - Math.log2(120)) * 2));
    const shelfHigh = high / (1 + Math.pow(2, (Math.log2(8000) - lf) * 2));
    const bell = mid * Math.exp(-Math.pow(lf - Math.log2(2500), 2) / 1.2);
    const db = shelfLow + shelfHigh + bell;
    points.push(`${x * W},${H / 2 - (db / 15) * (H / 2 - 4)}`);
  }
  const line = points.join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
      {[120, 2500, 8000].map((f) => {
        const x = (Math.log10(f / 20) / 3) * W;
        return <line key={f} x1={x} x2={x} y1="0" y2={H} stroke="var(--muted-foreground)" strokeOpacity=".18" vectorEffect="non-scaling-stroke" />;
      })}
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${H / 2} ${line} ${W},${H / 2}`} fill="var(--ch-mic)" fillOpacity=".16" />
      <polyline points={line} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Kennlinie: Eingang gegen Ausgang, oberhalb der Schwelle flacher. */
function CompressorDisplay({ thresholdDb, ratio, makeupDb }: { thresholdDb: number; ratio: number; makeupDb: number }) {
  const S = 60;
  const map = (db: number) => ((db + S) / S) * 100;
  const out = (db: number) => (db < thresholdDb ? db : thresholdDb + (db - thresholdDb) / ratio) + makeupDb;
  const pts = [-S, thresholdDb, 0].map((db) => `${map(db)},${100 - map(Math.min(0, out(db)))}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full p-3">
      <line x1="0" y1="100" x2="100" y2="0" stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <line x1={map(thresholdDb)} x2={map(thresholdDb)} y1="0" y2="100" stroke="var(--muted-foreground)" strokeOpacity=".2" vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke="var(--ch-mic)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Absenkung als Balken von rechts. */
function ReductionDisplay({ db, max }: { db: number; max: number }) {
  const amount = Math.min(1, Math.max(0, -db / max));
  return (
    <div className="absolute inset-0 flex items-center px-4">
      <div className="relative h-3 w-full" style={{ maskImage: SEGMENTS, WebkitMaskImage: SEGMENTS }}>
        <div className="absolute inset-0 bg-[var(--led-off)]" />
        <div className="absolute inset-y-0 right-0 bg-warning" style={{ width: `${amount * 100}%` }} />
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

  return (
    <div className="grid h-full auto-rows-fr gap-3 overflow-hidden px-6 pt-3 pb-3">
      <Module
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
        title="Rauschfilter"
        enabled={fx.denoise.enabled}
        onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
        status={
          fx.denoise.enabled &&
          running && <Reading tone={voice > 0.6 ? "success" : "default"}>{voice > 0.6 ? "Sprache" : "Ruhe"}</Reading>
        }
        display={<VoiceDisplay voice={voice} enabled={fx.denoise.enabled} />}
      >
        <div className="flex justify-between text-2xs">
          <span className="text-muted-foreground">Sprache erkannt</span>
          <span className="font-mono tabular-nums">{fx.denoise.enabled ? Math.round(voice * 100) : 0} %</span>
        </div>
      </Module>

      <Module
        title="Equalizer"
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
        title="Kompressor"
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
