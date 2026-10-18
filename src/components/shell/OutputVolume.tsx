import type { CSSProperties } from "react";
import { StripToggle, ToggleGroup } from "~/components/mixer/ChannelStrip";
import { Fader } from "~/components/mixer/Fader";
import { Meter } from "~/components/mixer/Meter";
import type { ChannelId } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn, formatDb } from "~/lib/utils";

/** Ein Kanalzug wie im Mischpult, nur kleiner. */
function MiniStrip({
  label,
  color,
  gainDb,
  muted,
  peak,
  onGain,
  onMute,
}: {
  label: string;
  color: string;
  gainDb: number;
  muted: boolean;
  peak: number;
  onGain: (db: number) => void;
  onMute: (muted: boolean) => void;
}) {
  return (
    <div style={{ "--ch": color } as CSSProperties} className="flex min-w-0 flex-1 flex-col items-stretch">
      <div className="flex items-baseline justify-between gap-1 px-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-3 w-1 shrink-0 rounded-full bg-[var(--ch)]" />
          <span className="truncate text-xs font-semibold">{label}</span>
        </span>
        <span
          className={cn(
            "font-mono text-3xs tabular-nums",
            muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-muted-foreground",
          )}
        >
          {muted ? "MUTE" : formatDb(gainDb)}
        </span>
      </div>
      <div className="flex h-24 justify-center">
        <Fader
          label={`${label} Lautstärke`}
          value={gainDb}
          onChange={onGain}
          meter={<Meter peak={muted ? 0 : peak} />}
          size="sm"
          className="py-2"
        />
      </div>
      <ToggleGroup>
        <StripToggle
          title={muted ? `${label} einschalten` : `${label} stummschalten`}
          on={muted}
          tone="error"
          onClick={() => onMute(!muted)}
        >
          Stumm
        </StripToggle>
      </ToggleGroup>
    </div>
  );
}

const SOUNDS: ChannelId[] = ["soundboard", "music"];

/**
 * Kleines Pult in der Sidebar: Mikrofon und alle Sounds (Soundboard und Musik
 * gemeinsam). Wirkt auf dieselben Fader wie das Mischpult.
 */
export function OutputVolume() {
  const channels = useStore((s) => s.channels);
  const meters = useStore((s) => (s.info ? s.meters : null));
  const peakOf = (id: ChannelId) => meters?.channels.find((c) => c.id === id)?.peak ?? 0;

  const mic = channels.mic;
  const soundsGain = Math.max(...SOUNDS.map((id) => channels[id].gainDb));
  const soundsMuted = SOUNDS.every((id) => channels[id].muted);
  const soundsPeak = Math.max(...SOUNDS.map((id) => (channels[id].muted ? 0 : peakOf(id))));

  return (
    <div className="flex gap-2 divide-x divide-hairline rounded-xl bg-sidebar-accent p-2.5 [&>*+*]:pl-2">
      <MiniStrip
        label="Mikrofon"
        color="var(--ch-mic)"
        gainDb={mic.gainDb}
        muted={mic.muted}
        peak={peakOf("mic")}
        onGain={(gainDb) => actions.setChannel("mic", { gainDb })}
        onMute={(muted) => actions.setChannel("mic", { muted })}
      />
      <MiniStrip
        label="Sounds"
        color="var(--ch-soundboard)"
        gainDb={soundsGain}
        muted={soundsMuted}
        peak={soundsPeak}
        onGain={(gainDb) => SOUNDS.forEach((id) => actions.setChannel(id, { gainDb }))}
        onMute={(muted) => SOUNDS.forEach((id) => actions.setChannel(id, { muted }))}
      />
    </div>
  );
}
