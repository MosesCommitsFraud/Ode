import {
  Headphones,
  Loader2,
  Mic2,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "~/components/ui/button";
import { downloads } from "~/lib/downloads";
import { formatTime, music, useMusic, type Repeat as RepeatMode } from "~/lib/music";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_TITLE: Record<RepeatMode, string> = {
  off: "Wiederholen: aus",
  all: "Wiederholen: alle",
  one: "Wiederholen: dieser Titel",
};

/** Lautstärke-Regler: 0–100 % entspricht −40 … +6 dB, ganz links = aus. */
function volumeToDb(v: number) {
  return v <= 0.01 ? -60 : Math.round((-40 + v * 46) * 2) / 2;
}

function dbToVolume(db: number) {
  return db <= -60 ? 0 : Math.min(1, Math.max(0, (db + 40) / 46));
}

/** Fortschrittsbalken mit Klicken und Ziehen zum Springen. */
function SeekBar({ position, duration }: { position: number; duration: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (duration > 0 ? position / duration : 0);

  const fraction = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onDown = (e: PointerEvent) => {
    if (duration <= 0 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fraction(e.clientX));
  };
  const onMove = (e: PointerEvent) => {
    if (drag !== null) setDrag(fraction(e.clientX));
  };
  const onUp = (e: PointerEvent) => {
    if (drag === null) return;
    void music.seek(fraction(e.clientX) * duration);
    setDrag(null);
  };

  return (
    <div className="flex w-full max-w-md items-center gap-2 font-mono text-3xs text-muted-foreground tabular-nums">
      <span className="w-8 text-right">{formatTime(shown * duration)}</span>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className={cn("group relative flex h-3 flex-1 items-center", duration > 0 && "cursor-pointer")}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-meter-track">
          <div className="h-full rounded-full bg-[var(--ch-music)]" style={{ width: `${shown * 100}%` }} />
        </div>
        {duration > 0 && (
          <span
            className="absolute h-3 w-1.5 -translate-x-1/2 rounded-sm bg-foreground opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${shown * 100}%` }}
          />
        )}
      </div>
      <span className="w-8">{formatTime(duration)}</span>
    </div>
  );
}

function RouteToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 cursor-default items-center gap-1 rounded-lg px-2 font-mono text-3xs font-semibold transition-colors [&_svg]:size-3.5",
        active
          ? "bg-[color-mix(in_oklch,var(--ch-music)_18%,transparent)] text-[var(--ch-music)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Schwebende Musik-Leiste unten: Titel, Steuerung, Fortschritt, Lautstärke und Wege. */
export function MusicBar() {
  const player = useMusic((s) => s.player);
  const channel = useStore((s) => s.channels.music);

  useEffect(() => {
    void music.init();
    // Fertige Downloads sollen die Bibliothek auf jeder Seite neu laden.
    void downloads.init();
  }, []);

  const { track } = player;
  const hasTrack = track !== null;
  const volume = channel.muted ? 0 : dbToVolume(channel.gainDb);
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="px-4 pb-3">
      <div className="mx-auto flex h-14 items-center gap-4 rounded-xl border border-border bg-card px-3 shadow-dock">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md",
              hasTrack
                ? "bg-[color-mix(in_oklch,var(--ch-music)_18%,transparent)] text-[var(--ch-music)]"
                : "bg-muted text-muted-foreground",
            )}
          >
            {player.loading ? <Loader2 className="size-4 animate-spin" /> : <Music className="size-4" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm">{track?.title ?? "Nichts in der Wiedergabe"}</div>
            <div className="truncate text-2xs text-muted-foreground">
              {player.error ??
                (player.loading
                  ? "Lädt …"
                  : hasTrack
                    ? [track.artist, player.queueLength > 1 && `${player.queueIndex + 1} von ${player.queueLength}`]
                        .filter(Boolean)
                        .join(" · ") || "Musik"
                    : "Titel in der Musik-Ansicht wählen")}
            </div>
          </div>
        </div>

        <div className="flex flex-[1.4] flex-col items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              title={player.shuffle ? "Zufall: an" : "Zufall: aus"}
              aria-pressed={player.shuffle}
              onClick={() => music.setShuffle(!player.shuffle)}
              className={cn(player.shuffle && "text-[var(--ch-music)] hover:text-[var(--ch-music)]")}
            >
              <Shuffle />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={!hasTrack} title="Zurück" onClick={() => music.previous()}>
              <SkipBack />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              disabled={!hasTrack}
              title={player.playing ? "Pause" : "Abspielen"}
              onClick={() => music.toggle()}
              className="rounded-full"
            >
              {player.playing ? <Pause /> : <Play />}
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={!hasTrack} title="Weiter" onClick={() => music.next()}>
              <SkipForward />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={REPEAT_TITLE[player.repeat]}
              aria-pressed={player.repeat !== "off"}
              onClick={() => music.setRepeat(NEXT_REPEAT[player.repeat])}
              className={cn(player.repeat !== "off" && "text-[var(--ch-music)] hover:text-[var(--ch-music)]")}
            >
              {player.repeat === "one" ? <Repeat1 /> : <Repeat />}
            </Button>
          </div>
          <SeekBar position={player.positionMs} duration={player.durationMs} />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 text-muted-foreground">
          <RouteToggle
            title="Musik auf Kopfhörer (A)"
            active={channel.routeA}
            onClick={() => actions.setChannel("music", { routeA: !channel.routeA })}
          >
            <Headphones />A
          </RouteToggle>
          <RouteToggle
            title="Musik ins virtuelle Mikrofon (B)"
            active={channel.routeB}
            onClick={() => actions.setChannel("music", { routeB: !channel.routeB })}
          >
            <Mic2 />B
          </RouteToggle>
          <button
            type="button"
            title={channel.muted ? "Musik einschalten" : "Musik stumm"}
            onClick={() => actions.setChannel("music", { muted: !channel.muted })}
            className="flex size-7 cursor-default items-center justify-center rounded-lg hover:bg-accent hover:text-foreground"
          >
            <VolumeIcon className="size-4" />
          </button>
          <input
            type="range"
            aria-label="Musik-Lautstärke"
            title={`${channel.gainDb > -60 ? channel.gainDb.toFixed(1) : "−∞"} dB`}
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              actions.setChannel("music", { gainDb: volumeToDb(v), muted: false });
            }}
            className="h-1 w-24 cursor-default appearance-none rounded-full [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
            style={{
              background: `linear-gradient(to right, var(--ch-music) ${volume * 100}%, var(--meter-track) 0)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
