import type { ReactNode } from "react";
import { Card } from "~/components/ui/misc";
import type { ChannelId, ChannelParams, OutputId, OutputParams } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { ChannelStrip } from "./ChannelStrip";

/** Auslieferungszustand der Kanäle und Ausgänge, wie im Store. */
export const CHANNEL_DEFAULTS: Record<ChannelId, ChannelParams> = {
  mic: { gainDb: 0, muted: false, routeA: false, routeB: true },
  soundboard: { gainDb: 0, muted: false, routeA: true, routeB: true },
  music: { gainDb: 0, muted: false, routeA: true, routeB: true },
  live: { gainDb: 0, muted: false, routeA: true, routeB: true },
};

export const OUTPUT_DEFAULTS: Record<OutputId, OutputParams> = {
  a: { gainDb: 0, muted: false, limiter: false },
  b: { gainDb: 0, muted: false, limiter: true },
};

export function same<T extends object>(a: T, b: T) {
  return (Object.keys(b) as (keyof T)[]).every((k) => a[k] === b[k]);
}

/** Kanalzug eines Kanals als eigene Karte rechts auf seiner Seite. */
export function PageChannel({
  id,
  name,
  icon,
  color,
}: {
  id: ChannelId;
  name: string;
  icon: ReactNode;
  color: string;
}) {
  const params = useStore((s) => s.channels[id]);
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === id)?.peak ?? 0) : 0));

  return (
    <Card className="flex min-h-0 shrink-0 p-1.5">
      <ChannelStrip
        name={name}
        icon={icon}
        color={color}
        gainDb={params.gainDb}
        muted={params.muted}
        peak={peak}
        onGain={(gainDb) => actions.setChannel(id, { gainDb })}
        onMute={(muted) => actions.setChannel(id, { muted })}
        routing={{
          a: params.routeA,
          b: params.routeB,
          onA: (routeA) => actions.setChannel(id, { routeA }),
          onB: (routeB) => actions.setChannel(id, { routeB }),
        }}
        isDefault={same(params, CHANNEL_DEFAULTS[id])}
        onReset={() => actions.setChannel(id, CHANNEL_DEFAULTS[id])}
      />
    </Card>
  );
}
