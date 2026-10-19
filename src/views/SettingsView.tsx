import { DeviceSetup } from "~/components/mixer/DeviceSetup";
import { GeneralSettings } from "~/components/setup/GeneralSettings";
import { UpdateCard } from "~/components/setup/UpdateCard";
import { Badge, Card, Segmented } from "~/components/ui/misc";
import { actions, useStore } from "~/lib/store";

const PARTS = [
  { key: "in", label: "Eingangspuffer", color: "var(--ch-mic)" },
  { key: "mid", label: "Zwischenpuffer B", color: "var(--ch-soundboard)" },
  { key: "out", label: "Ausgangspuffer B", color: "var(--ch-music)" },
] as const;

const TARGET_MS = 30;

function LatencyCard() {
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);

  const latency = meters?.latencyMs ?? 0;
  const tone = latency < TARGET_MS ? "success" : latency < 50 ? "warning" : "error";
  const parts = meters
    ? { in: meters.inputCallbackMs, mid: meters.outB.bufferedMs, out: meters.outB.callbackMs }
    : { in: 0, mid: 0, out: 0 };
  const total = parts.in + parts.mid + parts.out || 1;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">Latenz</h2>
        {running && <Badge tone={tone}>Ziel &lt; {TARGET_MS} ms</Badge>}
      </div>

      {running && meters ? (
        <>
          <div className="mt-3 font-display text-4xl leading-none font-semibold tracking-tight tabular-nums">
            {latency.toFixed(1)}
            <span className="ml-1 font-sans text-base font-normal text-muted-foreground">ms</span>
          </div>

          <div className="mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            {PARTS.map((p) => (
              <span
                key={p.key}
                className="h-full rounded-full"
                style={{ width: `${(parts[p.key] / total) * 100}%`, background: p.color }}
              />
            ))}
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            {PARTS.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-1.5 w-3 rounded-full" style={{ background: p.color }} />
                  {p.label}
                </dt>
                <dd className="font-mono tabular-nums">{parts[p.key].toFixed(1)} ms</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-hairline pt-1.5">
              <dt className="pl-5 text-muted-foreground">Aussetzer · Korrekturen</dt>
              <dd className="font-mono tabular-nums">
                {meters.outA.underruns + meters.outB.underruns} · {meters.outA.overruns + meters.outB.overruns}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Engine aus</p>
      )}
    </Card>
  );
}

function BufferCard() {
  const bufferMs = useStore((s) => s.config.bufferMs);
  return (
    <Card className="p-5">
      <h2
        className="mb-3 font-display text-lg font-semibold tracking-tight"
        title="Kleiner = weniger Verzögerung, größer = robuster gegen Knackser"
      >
        Puffer
      </h2>
      <Segmented
        value={bufferMs}
        options={[5, 10, 20, 40]}
        onChange={(ms) => actions.setConfig({ bufferMs: ms })}
        format={(ms) => `${ms} ms`}
      />
    </Card>
  );
}

export function SettingsView() {
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_20rem] items-start gap-4 overflow-hidden pl-6 pr-3 pt-3 pb-4">
      <div className="space-y-4">
        <DeviceSetup />
        <GeneralSettings />
      </div>
      <div className="space-y-4">
        <LatencyCard />
        <BufferCard />
        <UpdateCard />
      </div>
    </div>
  );
}
