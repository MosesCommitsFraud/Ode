import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { dbToPosition, MAX_DB, MIN_DB, positionToDb } from "~/components/mixer/Fader";
import type { ChannelId } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn, formatDb, gainToDb } from "~/lib/utils";

const FLOOR = -60;
const FALL_DB = 1.6;

/** Ein Schnellregler: Lautstärke ziehen, Pegel läuft im Balken mit, Symbol schaltet stumm. */
function QuickFader({
  label,
  color,
  icon,
  mutedIcon,
  gainDb,
  muted,
  peak,
  onGain,
  onMute,
}: {
  label: string;
  color: string;
  icon: ReactNode;
  mutedIcon: ReactNode;
  gainDb: number;
  muted: boolean;
  peak: number;
  onGain: (db: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const display = useRef(FLOOR);

  const db = gainToDb(muted ? 0 : peak, FLOOR);
  display.current = Math.max(db, display.current - FALL_DB);
  const level = Math.min(1, Math.max(0, (display.current - FLOOR) / -FLOOR));
  const pos = dbToPosition(gainDb);

  const update = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    onGain(positionToDb(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))));
  };

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onGain(Math.min(MAX_DB, gainDb + step));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onGain(Math.max(MIN_DB, gainDb - step));
    else if (e.key === "Home") onGain(0);
    else return;
    e.preventDefault();
  };

  return (
    <div style={{ "--ch": color } as CSSProperties} className="flex items-center gap-2.5">
      <button
        type="button"
        title={muted ? `${label} einschalten` : `${label} stummschalten`}
        aria-pressed={muted}
        onClick={() => onMute(!muted)}
        className={cn(
          "flex size-8 shrink-0 cursor-default items-center justify-center rounded-lg transition-colors [&_svg]:size-4",
          muted
            ? "bg-error/14 text-error-foreground"
            : "bg-[color-mix(in_oklch,var(--ch)_16%,transparent)] text-[var(--ch)] hover:bg-[color-mix(in_oklch,var(--ch)_24%,transparent)]",
        )}
      >
        {muted ? mutedIcon : icon}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium">{label}</span>
          <span className={cn("font-mono text-3xs tabular-nums", muted ? "text-error-foreground" : "text-muted-foreground")}>
            {muted ? "stumm" : `${formatDb(gainDb)} dB`}
          </span>
        </div>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={`Lautstärke ${label}`}
          aria-valuemin={MIN_DB}
          aria-valuemax={MAX_DB}
          aria-valuenow={gainDb}
          aria-valuetext={`${formatDb(gainDb)} dB`}
          title="Doppelklick: 0 dB"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={() => onGain(0)}
          onKeyDown={onKeyDown}
          className="group relative h-4 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="well absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            <div
              className="absolute inset-y-0 left-0 bg-[color-mix(in_oklch,var(--ch)_35%,transparent)]"
              style={{ width: `${pos * 100}%` }}
            />
            <div className="absolute inset-y-0 left-0 bg-[var(--ch)]" style={{ width: `${Math.min(level, pos) * 100}%` }} />
          </div>
          <div
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/45%)] transition-transform group-active:scale-110"
            style={{ left: `${pos * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

const SOUNDS: ChannelId[] = ["soundboard", "music"];

/**
 * Schnellzugriff in der Sidebar: Mikrofon und alle Sounds (Soundboard und Musik
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
    <div className="space-y-3 rounded-xl bg-sidebar-accent p-2.5">
      <QuickFader
        label="Mikrofon"
        color="var(--ch-mic)"
        icon={<Mic />}
        mutedIcon={<MicOff />}
        gainDb={mic.gainDb}
        muted={mic.muted}
        peak={peakOf("mic")}
        onGain={(gainDb) => actions.setChannel("mic", { gainDb })}
        onMute={(muted) => actions.setChannel("mic", { muted })}
      />
      <QuickFader
        label="Sounds"
        color="var(--ch-soundboard)"
        icon={<Volume2 />}
        mutedIcon={<VolumeX />}
        gainDb={soundsGain}
        muted={soundsMuted}
        peak={soundsPeak}
        onGain={(gainDb) => SOUNDS.forEach((id) => actions.setChannel(id, { gainDb }))}
        onMute={(muted) => SOUNDS.forEach((id) => actions.setChannel(id, { muted }))}
      />
    </div>
  );
}
