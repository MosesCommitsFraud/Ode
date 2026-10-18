import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Disc3,
  Loader2,
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
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { SetupWizard } from "~/components/setup/SetupWizard";
import { downloads } from "~/lib/downloads";
import { isTauri } from "~/lib/engine";
import { formatTime, music, useMusic, type PlayerState, type Repeat as RepeatMode, type Track } from "~/lib/music";
import { cn } from "~/lib/utils";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_TITLE: Record<RepeatMode, string> = {
  off: "Wiederholen: aus",
  all: "Wiederholen: alle",
  one: "Wiederholen: dieser Titel",
};

/* Lautstärke und Cover kommen mit dem nächsten Stand der Musik-Bibliothek;
   bis dahin bleiben die Felder optional. */
type WithVolume = PlayerState & { volume?: number };
type WithCover = Track & { cover?: string | null };
const player = music as typeof music & { setVolume?: (v: number) => void };

/** Waagerechter Regler mit Ziehen, Klicken und Pfeiltasten. Wert 0–1. */
function useDrag(onChange: (v: number) => void, onCommit?: (v: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const fraction = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const v = fraction(e.clientX);
      setDrag(v);
      onChange(v);
    },
    onPointerMove: (e: PointerEvent) => {
      if (drag === null) return;
      const v = fraction(e.clientX);
      setDrag(v);
      onChange(v);
    },
    onPointerUp: (e: PointerEvent) => {
      if (drag === null) return;
      onCommit?.(fraction(e.clientX));
      setDrag(null);
    },
  };
  return { ref, drag, handlers };
}

/** Zeitleiste: wird beim Hovern dicker, zeigt den Griff und springt per Klick. */
function Timeline({ position, duration }: { position: number; duration: number }) {
  const { ref, drag, handlers } = useDrag(() => {}, (v) => void music.seek(v * duration));
  const enabled = duration > 0;
  const shown = drag ?? (enabled ? position / duration : 0);

  return (
    <div className="flex w-full max-w-lg items-center gap-2.5 font-mono text-3xs text-muted-foreground tabular-nums">
      <span className="w-9 text-right">{formatTime(shown * duration)}</span>
      <div
        ref={ref}
        {...(enabled ? handlers : {})}
        className={cn("group relative flex h-4 flex-1 touch-none items-center", !enabled && "opacity-50")}
      >
        <div
          className={cn(
            "well relative h-1 w-full overflow-hidden rounded-full transition-[height] duration-150",
            enabled && "group-hover:h-1.5",
            drag !== null && "h-1.5",
          )}
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--ch-music)]" style={{ width: `${shown * 100}%` }} />
        </div>
        {enabled && (
          <span
            className={cn(
              "absolute size-3 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/45%)] transition-transform duration-150",
              drag !== null ? "scale-100" : "scale-0 group-hover:scale-100",
            )}
            style={{ left: `${shown * 100}%` }}
          />
        )}
      </div>
      <span className="w-9">{formatTime(duration)}</span>
    </div>
  );
}

function VolumeSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  const { ref, handlers } = useDrag(onChange);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(1, value + 0.05));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, value - 0.05));
    else return;
    e.preventDefault();
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Player-Lautstärke"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-disabled={disabled}
      title={disabled ? "Kommt mit dem nächsten Musik-Update" : `${Math.round(value * 100)} %`}
      {...(disabled ? {} : handlers)}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn(
        "group relative flex h-4 w-24 touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "opacity-40",
      )}
    >
      <div className="well relative h-1 w-full overflow-hidden rounded-full transition-[height] duration-150 group-hover:h-1.5">
        <div className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${value * 100}%` }} />
      </div>
      <span
        className="absolute size-3 -translate-x-1/2 scale-0 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/45%)] transition-transform duration-150 group-hover:scale-100"
        style={{ left: `${value * 100}%` }}
      />
    </div>
  );
}

function ControlButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 cursor-default items-center justify-center rounded-full transition-colors disabled:opacity-35 [&_svg]:size-4",
        active ? "text-[var(--ch-music)]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Cover({ track, loading }: { track: WithCover | null; loading: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = track?.cover && isTauri ? convertFileSrc(track.cover) : null;
  useEffect(() => setFailed(false), [src]);

  return (
    <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted shadow-[0_0_0_1px_var(--hairline)]">
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <div
          className={cn(
            "flex size-full items-center justify-center [&_svg]:size-5",
            track ? "text-[var(--ch-music)]" : "text-muted-foreground",
          )}
        >
          <Disc3 />
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
    </div>
  );
}

/** Schwebende Musik-Leiste unten: Titel mit Cover, Steuerung, Zeitleiste, Player-Lautstärke. */
export function MusicBar() {
  const state = useMusic((s) => s.player) as WithVolume;

  useEffect(() => {
    void music.init();
    // Fertige Downloads sollen die Bibliothek auf jeder Seite neu laden.
    void downloads.init();
  }, []);

  const track = state.track as WithCover | null;
  const hasTrack = track !== null;
  const canSetVolume = typeof player.setVolume === "function";
  const volume = state.volume ?? 1;
  const lastVolume = useRef(volume > 0 ? volume : 1);
  if (volume > 0) lastVolume.current = volume;
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="px-4 pb-3">
      <div className="mx-auto flex h-14 items-center gap-4 rounded-xl border border-border bg-card px-2.5 shadow-dock">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Cover track={track} loading={state.loading} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{track?.title ?? "Nichts in der Wiedergabe"}</div>
            <div className={cn("truncate text-2xs", state.error ? "text-error-foreground" : "text-muted-foreground")}>
              {state.error ?? (state.loading ? "Lädt …" : (track?.artist ?? (hasTrack ? "Unbekannt" : "—")))}
            </div>
          </div>
        </div>

        <div className="flex flex-[1.4] flex-col items-center gap-0.5">
          <div className="flex items-center gap-1">
            <ControlButton
              title={state.shuffle ? "Zufall: an" : "Zufall: aus"}
              active={state.shuffle}
              onClick={() => music.setShuffle(!state.shuffle)}
            >
              <Shuffle />
            </ControlButton>
            <ControlButton title="Zurück" disabled={!hasTrack} onClick={() => music.previous()}>
              <SkipBack className="fill-current" />
            </ControlButton>
            <button
              type="button"
              disabled={!hasTrack}
              title={state.playing ? "Pause" : "Abspielen"}
              onClick={() => music.toggle()}
              className="mx-1 flex size-8 cursor-default items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-95 disabled:opacity-35 [&_svg]:size-4 [&_svg]:fill-current"
            >
              {state.playing ? <Pause /> : <Play className="translate-x-px" />}
            </button>
            <ControlButton title="Weiter" disabled={!hasTrack} onClick={() => music.next()}>
              <SkipForward className="fill-current" />
            </ControlButton>
            <ControlButton
              title={REPEAT_TITLE[state.repeat]}
              active={state.repeat !== "off"}
              onClick={() => music.setRepeat(NEXT_REPEAT[state.repeat])}
            >
              {state.repeat === "one" ? <Repeat1 /> : <Repeat />}
            </ControlButton>
          </div>
          <Timeline position={state.positionMs} duration={state.durationMs} />
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5 pr-1.5">
          <ControlButton
            title={volume === 0 ? "Ton an" : "Stumm"}
            disabled={!canSetVolume}
            onClick={() => player.setVolume?.(volume === 0 ? lastVolume.current : 0)}
          >
            <VolumeIcon />
          </ControlButton>
          <VolumeSlider value={volume} disabled={!canSetVolume} onChange={(v) => player.setVolume?.(v)} />
        </div>
      </div>
      {/* Einrichtungsassistent beim ersten Start (Portal, liegt nur hier, weil die Leiste immer da ist). */}
      <SetupWizard />
    </div>
  );
}
