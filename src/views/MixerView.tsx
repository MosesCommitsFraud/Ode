import { Cable, Headphones, Mic, Music, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ChannelStrip } from "~/components/mixer/ChannelStrip";
import { Card, SectionLabel, Segmented, Switch } from "~/components/ui/misc";
import type { ChannelId, ChannelParams, Meters, OutputId, OutputParams } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const CHANNELS: { id: ChannelId; name: string; icon: ReactNode; color: string; ready: boolean }[] = [
  { id: "mic", name: "Mikrofon", icon: <Mic />, color: "var(--ch-mic)", ready: true },
  { id: "soundboard", name: "Soundboard", icon: <Sparkles />, color: "var(--ch-soundboard)", ready: true },
  { id: "music", name: "Musik", icon: <Music />, color: "var(--ch-music)", ready: true },
];

const OUTPUTS: { id: OutputId; name: string; kind: string; icon: ReactNode }[] = [
  { id: "a", name: "Kopfhörer", kind: "Bus A", icon: <Headphones /> },
  { id: "b", name: "Kabel", kind: "Bus B", icon: <Cable /> },
];

/** Auslieferungszustand der Kanäle und Ausgänge, wie im Store. */
const CHANNEL_DEFAULTS: Record<ChannelId, ChannelParams> = {
  mic: { gainDb: 0, muted: false, routeA: false, routeB: true },
  soundboard: { gainDb: 0, muted: false, routeA: true, routeB: true },
  music: { gainDb: 0, muted: false, routeA: true, routeB: true },
};

const OUTPUT_DEFAULTS: Record<OutputId, OutputParams> = {
  a: { gainDb: 0, muted: false, limiter: false },
  b: { gainDb: 0, muted: false, limiter: true },
};

function same<T extends object>(a: T, b: T) {
  return (Object.keys(b) as (keyof T)[]).every((k) => a[k] === b[k]);
}

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
    <Card className="flex min-h-0 flex-1 p-1.5">
      <section className="flex flex-col">
        <div className="flex items-center justify-between pt-1.5 pr-1.5 pl-3">
          <SectionLabel>Eingänge</SectionLabel>
          <button
            type="button"
            title="Alle Fader auf 0 dB"
            disabled={!changed}
            onClick={() => actions.resetLevels()}
            className="flex h-6 cursor-default items-center gap-1.5 rounded-full bg-muted px-2.5 font-mono text-3xs font-semibold text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 [&_svg]:size-3"
          >
            <RotateCcw /> Alles auf 0 dB
          </button>
        </div>
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
                isDefault={same(params, CHANNEL_DEFAULTS[id])}
                onReset={() => actions.setChannel(id, CHANNEL_DEFAULTS[id])}
              />
            );
          })}
        </div>
      </section>

      <div className="min-w-3 flex-1" />

      <section className="well flex flex-col rounded-xl">
        <SectionLabel className="flex h-[30px] items-center px-3 pt-1.5">Ausgänge</SectionLabel>
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
                isDefault={same(params, OUTPUT_DEFAULTS[id])}
                onReset={() => actions.setOutput(id, OUTPUT_DEFAULTS[id])}
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

const AMOUNTS = [6, 12, 18, 24];
const SENSITIVITY: { db: number; label: string }[] = [
  { db: -50, label: "Hoch" },
  { db: -40, label: "Mittel" },
  { db: -30, label: "Niedrig" },
];

/** Ducking als schmale Leiste unter dem Pult. */
function DuckingBar() {
  const ducking = useStore((s) => s.ducking);
  const duckingDb = useStore((s) => s.meters?.duckingDb ?? 0);
  const active = ducking.enabled && duckingDb < -0.5;

  return (
    <Card className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
      <div className="flex items-center gap-3">
        <Switch
          label="Ducking"
          checked={ducking.enabled}
          onCheckedChange={(enabled) => actions.setDucking({ enabled })}
        />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Ducking</div>
          <div className="text-2xs text-muted-foreground">Soundboard und Musik leiser, während du sprichst</div>
        </div>
      </div>

      <div className={cn("ml-auto flex items-center gap-4", !ducking.enabled && "pointer-events-none opacity-45")}>
        <div className="flex items-center gap-2">
          <SectionLabel>Absenkung</SectionLabel>
          <div className="w-56">
            <Segmented
              value={ducking.amountDb}
              options={AMOUNTS}
              onChange={(amountDb) => actions.setDucking({ amountDb })}
              format={(db) => `−${db}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SectionLabel>Empfindlich</SectionLabel>
          <div className="w-56">
            <Segmented
              value={ducking.thresholdDb}
              options={SENSITIVITY.map((s) => s.db)}
              onChange={(thresholdDb) => actions.setDucking({ thresholdDb })}
              format={(db) => SENSITIVITY.find((s) => s.db === db)?.label ?? `${db} dB`}
            />
          </div>
        </div>
        <span
          className={cn(
            "w-16 text-right font-mono text-2xs tabular-nums text-muted-foreground",
            active && "text-[var(--ch-soundboard)]",
          )}
        >
          {active ? `${duckingDb.toFixed(1)} dB` : "ruht"}
        </span>
      </div>
    </Card>
  );
}

export function MixerView() {
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-6 pt-3 pb-3">
      <Console />
      <DuckingBar />
    </div>
  );
}
