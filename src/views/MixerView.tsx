import { Cable, Headphones, Mic, Music, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { ChannelStrip } from "~/components/mixer/ChannelStrip";
import { DeviceSetup } from "~/components/mixer/DeviceSetup";
import { Badge, Card, SectionLabel, Segmented, Switch } from "~/components/ui/misc";
import type { ChannelId, Meters, OutputId } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const CHANNELS: { id: ChannelId; name: string; icon: ReactNode; color: string; ready: boolean }[] = [
  { id: "mic", name: "Mikrofon", icon: <Mic />, color: "var(--ch-mic)", ready: true },
  { id: "soundboard", name: "Soundboard", icon: <Sparkles />, color: "var(--ch-soundboard)", ready: true },
  { id: "music", name: "Musik", icon: <Music />, color: "var(--ch-music)", ready: false },
];

const OUTPUTS: { id: OutputId; name: string; kind: string; icon: ReactNode }[] = [
  { id: "a", name: "Kopfhörer", kind: "Bus A", icon: <Headphones /> },
  { id: "b", name: "Kabel", kind: "Bus B", icon: <Cable /> },
];

function channelPeak(meters: Meters | null, id: ChannelId) {
  return meters?.channels.find((c) => c.id === id)?.peak ?? 0;
}

function Console() {
  const channels = useStore((s) => s.channels);
  const outputs = useStore((s) => s.outputs);
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);
  const changed =
    Object.values(channels).some((c) => c.gainDb !== 0) || Object.values(outputs).some((o) => o.gainDb !== 0);

  return (
    <Card className="relative flex min-h-[27rem] flex-1 overflow-x-auto p-1.5">
      <button
        type="button"
        title="Alle Fader auf 0 dB"
        disabled={!changed}
        onClick={() => actions.resetLevels()}
        className="absolute top-2 right-2 z-10 flex h-7 cursor-default items-center gap-1.5 rounded-full bg-muted px-3 font-mono text-3xs font-semibold text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 [&_svg]:size-3"
      >
        <RotateCcw /> Alles auf 0 dB
      </button>
      <section className="flex flex-col">
        <SectionLabel className="px-3 pt-2.5">Eingänge</SectionLabel>
        <div className="flex flex-1 divide-x divide-hairline">
          {CHANNELS.map(({ id, name, icon, color, ready }) => {
            const params = channels[id];
            return (
              <ChannelStrip
                key={id}
                name={name}
                kind="Kanal"
                badge={ready ? undefined : "Phase 3"}
                icon={icon}
                color={color}
                gainDb={params.gainDb}
                muted={params.muted}
                peak={channelPeak(meters, id)}
                onGain={(gainDb) => actions.setChannel(id, { gainDb })}
                onMute={(muted) => actions.setChannel(id, { muted })}
                routing={{
                  a: params.routeA,
                  b: params.routeB,
                  onA: (routeA) => actions.setChannel(id, { routeA }),
                  onB: (routeB) => actions.setChannel(id, { routeB }),
                }}
                disabled={!ready}
              />
            );
          })}
        </div>
      </section>

      <div className="min-w-3 flex-1" />

      <section className="well flex flex-col rounded-xl">
        <SectionLabel className="px-3 pt-2.5">Ausgänge</SectionLabel>
        <div className="flex flex-1 divide-x divide-hairline">
          {OUTPUTS.map(({ id, name, kind, icon }) => {
            const params = outputs[id];
            const out = id === "a" ? meters?.outA : meters?.outB;
            const reducing = params.limiter && (out?.gainReductionDb ?? 0) < -0.1;
            return (
              <ChannelStrip
                key={id}
                name={name}
                kind={kind}
                icon={icon}
                color="var(--ch-out)"
                gainDb={params.gainDb}
                muted={params.muted}
                peak={running ? (out?.peak ?? 0) : 0}
                onGain={(gainDb) => actions.setOutput(id, { gainDb })}
                onMute={(muted) => actions.setOutput(id, { muted })}
                footer={
                  <label className="flex h-8 items-center justify-between gap-1 rounded-lg bg-muted pr-1.5 pl-2 font-mono text-2xs font-semibold text-muted-foreground">
                    <span className={cn("flex items-center gap-1 transition-colors", reducing && "text-warning-foreground")}>
                      <ShieldCheck className="size-3.5" /> LIM
                    </span>
                    <Switch
                      label="Limiter"
                      checked={params.limiter}
                      onCheckedChange={(limiter) => actions.setOutput(id, { limiter })}
                    />
                  </label>
                }
              />
            );
          })}
        </div>
      </section>
    </Card>
  );
}

const PARTS = [
  { key: "in", label: "Eingangspuffer", color: "var(--ch-mic)" },
  { key: "mid", label: "Zwischenpuffer B", color: "var(--ch-soundboard)" },
  { key: "out", label: "Ausgangspuffer B", color: "var(--ch-music)" },
] as const;

const TARGET_MS = 30;
const HISTORY = 90;

/** Verlauf der letzten Sekunden; die Skala folgt dem Wertebereich, damit kleine Schwankungen sichtbar bleiben. */
function Sparkline({ values }: { values: number[] }) {
  const lo = Math.min(...values) - 1;
  const hi = Math.max(...values, lo + 4) + 1;
  const y = (v: number) => 28 - ((v - lo) / (hi - lo)) * 26;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${y(v)}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-12 w-full overflow-visible">
      <defs>
        <linearGradient id="latency-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${points} 100,30`} fill="url(#latency-fill)" />
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function LatencyCard() {
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);
  const history = useRef<number[]>([]);

  const latency = meters?.latencyMs ?? 0;
  if (running && meters) history.current = [...history.current, latency].slice(-HISTORY);
  const padded = [...Array(Math.max(0, HISTORY - history.current.length)).fill(history.current[0] ?? 0), ...history.current];
  const tone = latency < TARGET_MS ? "success" : latency < 50 ? "warning" : "error";

  const parts = meters
    ? { in: meters.inputCallbackMs, mid: meters.outB.bufferedMs, out: meters.outB.callbackMs }
    : { in: 0, mid: 0, out: 0 };
  const total = parts.in + parts.mid + parts.out || 1;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <SectionLabel>Latenz</SectionLabel>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Mikrofon → Kabel</h2>
        </div>
        {running && <Badge tone={tone}>Ziel &lt; {TARGET_MS} ms</Badge>}
      </div>

      {running && meters ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="font-display text-5xl leading-none font-semibold tracking-tight tabular-nums">
              {latency.toFixed(1)}
              <span className="ml-1 font-sans text-base font-normal text-muted-foreground">ms</span>
            </div>
            <div className="w-28">
              <Sparkline values={padded} />
            </div>
          </div>

          <div className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {PARTS.map((p) => (
              <span
                key={p.key}
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${(parts[p.key] / total) * 100}%`, background: p.color }}
              />
            ))}
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            {PARTS.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: p.color }} />
                  {p.label}
                </dt>
                <dd className="font-mono tabular-nums">{parts[p.key].toFixed(1)} ms</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-hairline pt-1.5">
              <dt className="pl-4 text-muted-foreground">Aussetzer · Korrekturen</dt>
              <dd className="font-mono tabular-nums">
                {meters.outA.underruns + meters.outB.underruns} · {meters.outA.overruns + meters.outB.overruns}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-2xs text-muted-foreground">
            Geschätzt innerhalb der App, ohne Wandler- und Treiberlatenz.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Starte die Engine, um die Verzögerung zu messen.</p>
      )}
    </Card>
  );
}

function BufferCard() {
  const bufferMs = useStore((s) => s.config.bufferMs);
  return (
    <Card className="p-5">
      <SectionLabel>Puffer</SectionLabel>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        Kleiner = weniger Verzögerung, größer = robuster gegen Knackser.
      </p>
      <Segmented
        value={bufferMs}
        options={[5, 10, 20, 40]}
        onChange={(ms) => actions.setConfig({ bufferMs: ms })}
        format={(ms) => `${ms} ms`}
      />
    </Card>
  );
}

const AMOUNTS = [6, 12, 18, 24];
const SENSITIVITY: { db: number; label: string }[] = [
  { db: -50, label: "Hoch" },
  { db: -40, label: "Mittel" },
  { db: -30, label: "Niedrig" },
];

function DuckingCard() {
  const ducking = useStore((s) => s.ducking);
  const duckingDb = useStore((s) => s.meters?.duckingDb ?? 0);
  const active = ducking.enabled && duckingDb < -0.5;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Ducking</SectionLabel>
          <p className="mt-1 text-xs text-muted-foreground">
            Soundboard und Musik werden leiser, während du sprichst.
          </p>
        </div>
        <Switch
          label="Ducking"
          checked={ducking.enabled}
          onCheckedChange={(enabled) => actions.setDucking({ enabled })}
        />
      </div>

      <div className={cn("mt-4 space-y-3 transition-opacity", !ducking.enabled && "pointer-events-none opacity-45")}>
        <div className="space-y-1.5">
          <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
            <span>Absenkung</span>
            <span className={cn("tabular-nums transition-colors", active && "text-[var(--ch-soundboard)]")}>
              {active ? `jetzt ${duckingDb.toFixed(1)} dB` : "ruht"}
            </span>
          </div>
          <Segmented
            value={ducking.amountDb}
            options={AMOUNTS}
            onChange={(amountDb) => actions.setDucking({ amountDb })}
            format={(db) => `−${db} dB`}
          />
        </div>
        <div className="space-y-1.5">
          <div className="font-mono text-3xs text-muted-foreground uppercase">Empfindlichkeit</div>
          <Segmented
            value={ducking.thresholdDb}
            options={SENSITIVITY.map((s) => s.db)}
            onChange={(thresholdDb) => actions.setDucking({ thresholdDb })}
            format={(db) => SENSITIVITY.find((s) => s.db === db)?.label ?? `${db} dB`}
          />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
          <div
            className="h-full rounded-full bg-[var(--ch-soundboard)] transition-[width] duration-100"
            style={{ width: `${Math.min(100, (-duckingDb / Math.max(1, ducking.amountDb)) * 100)}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

export function MixerView() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto px-6 pt-3 pb-4">
      <Console />
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <DeviceSetup />
        <div className="space-y-4">
          <LatencyCard />
          <DuckingCard />
          <BufferCard />
        </div>
      </div>
    </div>
  );
}
