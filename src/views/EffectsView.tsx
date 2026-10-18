import { ArrowRight, AudioLines, Gauge, Mic, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Meter } from "~/components/mixer/Meter";
import { Badge, Card, SectionLabel, Switch } from "~/components/ui/misc";
import { actions, useStore } from "~/lib/store";
import { cn, formatDb } from "~/lib/utils";

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={cn("block space-y-1.5", disabled && "opacity-45")}>
      <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
        <span>{label}</span>
        <span className="text-foreground tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(Math.min(max, Math.max(min, 0)))}
        className="h-1.5 w-full cursor-default appearance-none rounded-full [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_oklch(0%_0_0/40%)]"
        style={{ background: `linear-gradient(to right, var(--ch-mic) ${fill}%, var(--meter-track) 0)` }}
      />
    </label>
  );
}

/** Balken für Absenkung in dB (0 … max). */
function Reduction({ db, max, label }: { db: number; max: number; label: string }) {
  const amount = Math.min(1, Math.max(0, -db / max));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
        <span>{label}</span>
        <span className="tabular-nums">{db < -0.05 ? `${db.toFixed(1)} dB` : "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
        <div className="h-full rounded-full bg-warning transition-[width] duration-75" style={{ width: `${amount * 100}%` }} />
      </div>
    </div>
  );
}

function Stage({
  index,
  title,
  hint,
  icon,
  enabled,
  onToggle,
  status,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  icon: ReactNode;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-1 flex-col p-4 transition-opacity", !enabled && "opacity-80")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-1.5 font-mono text-3xs [&_svg]:size-3.5",
              enabled ? "text-[var(--ch-mic)]" : "text-muted-foreground",
            )}
          >
            {icon}
            {String(index).padStart(2, "0")}
          </div>
          <h3 className="mt-1 font-display text-base leading-tight font-semibold tracking-tight hyphens-manual">
            {title}
          </h3>
        </div>
        <Switch label={title.replace("­", "")} checked={enabled} onCheckedChange={onToggle} />
      </div>
      <p className="mt-2 min-h-8 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 flex flex-1 flex-col gap-3">{children}</div>
      <div className="mt-4 flex h-6 items-center">{status}</div>
    </Card>
  );
}

export function EffectsView() {
  const fx = useStore((s) => s.effects);
  const meters = useStore((s) => s.meters);
  const micPeak = useStore((s) => s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0);
  const live = meters?.effects;
  const running = useStore((s) => s.info !== null);
  const activeCount = Object.values(fx).filter((e) => e.enabled).length;

  return (
    <div className="flex h-full flex-col gap-4 px-6 pt-5 pb-4">
      <Card className="flex items-center gap-4 px-5 py-3.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ch-mic)_16%,transparent)] text-[var(--ch-mic)]">
          <Mic className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <SectionLabel>Signalweg</SectionLabel>
          <div className="flex items-center gap-1.5 truncate text-sm">
            Mikrofon <ArrowRight className="size-3.5 text-muted-foreground" /> {activeCount} von 5 Effekten
            <ArrowRight className="size-3.5 text-muted-foreground" /> Mikrofon-Fader im Mischpult
          </div>
        </div>
        {!running && <Badge tone="warning">Engine aus</Badge>}
        <div className="w-56">
          <Meter peak={micPeak} orientation="horizontal" className="[--ch:var(--ch-mic)]" />
        </div>
      </Card>

      <div className="flex min-h-0 flex-1 gap-3">
        <Stage
          index={1}
          title="Noise Gate"
          hint="Schaltet das Mikro stumm, solange es leiser als die Schwelle ist."
          icon={<AudioLines />}
          enabled={fx.gate.enabled}
          onToggle={(enabled) => actions.setEffect("gate", { enabled })}
          status={
            fx.gate.enabled &&
            running && <Badge tone={live?.gateOpen ? "success" : "default"}>{live?.gateOpen ? "Offen" : "Zu"}</Badge>
          }
        >
          <Range
            label="Schwelle"
            value={fx.gate.thresholdDb}
            min={-80}
            max={-10}
            step={1}
            format={(v) => `${v} dB`}
            disabled={!fx.gate.enabled}
            onChange={(thresholdDb) => actions.setEffect("gate", { thresholdDb })}
          />
        </Stage>

        <Stage
          index={2}
          title={"Rausch­unterdrückung"}
          hint="RNNoise filtert Lüfter, Tastatur und Rauschen heraus. Kostet 10 ms Verzögerung."
          icon={<Sparkles />}
          enabled={fx.denoise.enabled}
          onToggle={(enabled) => actions.setEffect("denoise", { enabled })}
          status={fx.denoise.enabled && running && <Badge tone={(live?.voice ?? 0) > 0.6 ? "success" : "default"}>{(live?.voice ?? 0) > 0.6 ? "Sprache erkannt" : "Ruhe"}</Badge>}
        >
          <div className="space-y-1.5">
            <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
              <span>Sprache</span>
              <span className="tabular-nums">{Math.round((live?.voice ?? 0) * 100)} %</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
              <div
                className="h-full rounded-full bg-success transition-[width] duration-75"
                style={{ width: `${(fx.denoise.enabled ? (live?.voice ?? 0) : 0) * 100}%` }}
              />
            </div>
          </div>
        </Stage>

        <Stage
          index={3}
          title="Equalizer"
          hint="Klangfarbe: Bass bei 120 Hz, Präsenz bei 2,5 kHz, Höhen bei 8 kHz."
          icon={<SlidersHorizontal />}
          enabled={fx.eq.enabled}
          onToggle={(enabled) => actions.setEffect("eq", { enabled })}
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
        </Stage>

        <Stage
          index={4}
          title="Kompressor"
          hint="Gleicht leise und laute Stellen an, damit du gleichmäßig klingst."
          icon={<Gauge />}
          enabled={fx.compressor.enabled}
          onToggle={(enabled) => actions.setEffect("compressor", { enabled })}
          status={fx.compressor.enabled && running && <Reduction db={live?.compressorDb ?? 0} max={20} label="Absenkung" />}
        >
          <Range
            label="Schwelle"
            value={fx.compressor.thresholdDb}
            min={-50}
            max={0}
            step={1}
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
            format={(v) => `+${v.toFixed(1)} dB`}
            disabled={!fx.compressor.enabled}
            onChange={(makeupDb) => actions.setEffect("compressor", { makeupDb })}
          />
        </Stage>

        <Stage
          index={5}
          title="Limiter"
          hint="Harte Obergrenze für dein Mikro, damit Schreie nicht übersteuern."
          icon={<ShieldCheck />}
          enabled={fx.limiter.enabled}
          onToggle={(enabled) => actions.setEffect("limiter", { enabled })}
          status={fx.limiter.enabled && running && <Reduction db={live?.limiterDb ?? 0} max={12} label="Absenkung" />}
        >
          <Range
            label="Obergrenze"
            value={fx.limiter.ceilingDb}
            min={-20}
            max={0}
            step={0.5}
            format={(v) => `${formatDb(v)} dB`}
            disabled={!fx.limiter.enabled}
            onChange={(ceilingDb) => actions.setEffect("limiter", { ceilingDb })}
          />
        </Stage>
      </div>
    </div>
  );
}
