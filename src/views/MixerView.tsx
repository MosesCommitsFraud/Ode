import { Cable, Headphones, Mic, Music, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { ChannelStrip } from "~/components/mixer/ChannelStrip";
import { DeviceSetup } from "~/components/mixer/DeviceSetup";
import { Badge, Card, Switch } from "~/components/ui/misc";
import type { ChannelId, Meters, OutputId } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const CHANNELS: { id: ChannelId; name: string; icon: React.ReactNode; ready: boolean }[] = [
  { id: "mic", name: "Mikrofon", icon: <Mic />, ready: true },
  { id: "soundboard", name: "Soundboard", icon: <Sparkles />, ready: false },
  { id: "music", name: "Musik", icon: <Music />, ready: false },
];

const OUTPUTS: { id: OutputId; name: string; icon: React.ReactNode }[] = [
  { id: "a", name: "A · Kopfhörer", icon: <Headphones /> },
  { id: "b", name: "B · Kabel", icon: <Cable /> },
];

function channelPeak(meters: Meters | null, id: ChannelId) {
  return meters?.channels.find((c) => c.id === id)?.peak ?? 0;
}

function LatencyCard() {
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);
  const latency = meters?.latencyMs ?? 0;
  const tone = latency < 30 ? "success" : latency < 50 ? "warning" : "error";

  const rows: [string, string][] = meters
    ? [
        ["Eingangspuffer", `${meters.inputCallbackMs.toFixed(1)} ms`],
        ["Zwischenpuffer B", `${meters.outB.bufferedMs.toFixed(1)} ms`],
        ["Ausgangspuffer B", `${meters.outB.callbackMs.toFixed(1)} ms`],
        ["Aussetzer A / B", `${meters.outA.underruns} / ${meters.outB.underruns}`],
        ["Korrekturen A / B", `${meters.outA.overruns} / ${meters.outB.overruns}`],
      ]
    : [];

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="size-4 text-muted-foreground" />
          <h2 className="font-medium">Latenz</h2>
        </div>
        {running && <Badge tone={tone}>Ziel unter 30 ms</Badge>}
      </div>
      {running && meters ? (
        <>
          <div className="mb-3 font-mono text-3xl font-medium tabular-nums">
            {latency.toFixed(1)}
            <span className="ml-1 text-sm text-muted-foreground">ms</span>
          </div>
          <dl className="space-y-1 text-xs">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-2xs text-muted-foreground">
            Geschätzt innerhalb der App, ohne Wandler- und Treiberlatenz.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Starte die Engine, um die Verzögerung zu messen.</p>
      )}
    </Card>
  );
}

function BufferCard() {
  const bufferMs = useStore((s) => s.config.bufferMs);
  const steps = [5, 10, 20, 40];
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Puffer</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Kleiner = weniger Verzögerung, größer = robuster gegen Knackser.
      </p>
      <div className="grid grid-cols-4 gap-1 rounded-control bg-muted p-0.5">
        {steps.map((ms) => (
          <button
            key={ms}
            type="button"
            onClick={() => actions.setConfig({ bufferMs: ms })}
            className={cn(
              "h-7 cursor-default rounded-md font-mono text-xs tabular-nums transition-colors",
              bufferMs === ms ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ms} ms
          </button>
        ))}
      </div>
    </Card>
  );
}

export function MixerView() {
  const channels = useStore((s) => s.channels);
  const outputs = useStore((s) => s.outputs);
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <div className="flex min-h-[23rem] flex-1 gap-3 overflow-x-auto">
        {CHANNELS.map(({ id, name, icon, ready }) => {
          const params = channels[id];
          return (
            <ChannelStrip
              key={id}
              name={name}
              icon={icon}
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

        <div className="mx-1 w-px shrink-0 bg-border" />

        {OUTPUTS.map(({ id, name, icon }) => {
          const params = outputs[id];
          const out = id === "a" ? meters?.outA : meters?.outB;
          return (
            <ChannelStrip
              key={id}
              accent
              name={name}
              icon={icon}
              gainDb={params.gainDb}
              muted={params.muted}
              peak={running ? (out?.peak ?? 0) : 0}
              onGain={(gainDb) => actions.setOutput(id, { gainDb })}
              onMute={(muted) => actions.setOutput(id, { muted })}
              footer={
                <label className="flex items-center justify-between gap-1 pt-0.5 text-2xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="size-3" /> Limiter
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

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <DeviceSetup />
        <div className="space-y-4">
          <LatencyCard />
          <BufferCard />
        </div>
      </div>
    </div>
  );
}
