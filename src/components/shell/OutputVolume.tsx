import { VolumeX } from "lucide-react";
import type { CSSProperties } from "react";
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
        <span className="truncate text-xs font-semibold">{label}</span>
        <span
          className={cn(
            "font-mono text-3xs tabular-nums",
            muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-muted-foreground",
          )}
        >
          {muted ? "MUTE" : formatDb(gainDb)}
        </span>
      </div>
      <div className="flex h-28 justify-center">
        <Fader
          label={`${label} Lautstärke`}
          value={gainDb}
          onChange={onGain}
          meter={<Meter peak={muted ? 0 : peak} />}
          size="sm"
          className="py-2"
        />
      </div>
      <button
        type="button"
        title={muted ? `${label} einschalten` : `${label} stummschalten`}
        aria-pressed={muted}
        onClick={() => onMute(!muted)}
        className={cn(
          "flex h-7 cursor-default items-center justify-center gap-1 rounded-lg font-mono text-3xs font-semibold transition-colors [&_svg]:size-3",
          muted
            ? "bg-error/16 text-error-foreground shadow-[0_0_0_1px_color-mix(in_oklch,var(--error)_40%,transparent)_inset]"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <VolumeX />
        MUTE
      </button>
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
