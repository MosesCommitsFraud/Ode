import { Pencil, Square, Star } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { Kbd } from "~/components/ui/misc";
import { library, soundColor, type Sound } from "~/lib/library";
import { cn } from "~/lib/utils";
import { hotkeyLabel } from "./hotkey";
import { Waveform } from "./Waveform";

function formatDuration(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function SoundTile({
  sound,
  progress,
  onEdit,
}: {
  sound: Sound;
  /** Fortschritt 0–1, wenn der Sound gerade läuft. */
  progress: number | undefined;
  onEdit: () => void;
}) {
  const color = soundColor(sound.color);
  const playing = progress !== undefined;
  const length =
    (sound.trimEndMs || sound.durationMs) - Math.min(sound.trimStartMs, sound.durationMs);

  const stopPropagation = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => library.play(sound.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void library.play(sound.id);
        }
      }}
      style={{ "--tile": color } as CSSProperties}
      className={cn(
        "group panel relative flex h-32 cursor-default flex-col overflow-hidden rounded-2xl p-3 text-left outline-none transition-all duration-150 select-none",
        "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 active:scale-[0.98]",
        playing &&
          "shadow-[0_0_0_1.5px_var(--tile),0_10px_30px_-10px_var(--tile)]",
      )}
    >
      {/* Farbiger Schimmer oben links */}
      <span
        className="pointer-events-none absolute -top-10 -left-10 size-28 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-40"
        style={{ background: color }}
      />

      <div className="relative flex items-start gap-2">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: playing ? `0 0 10px ${color}` : undefined }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-semibold">{sound.name}</div>
          <div className="mt-0.5 truncate font-mono text-3xs text-muted-foreground tabular-nums">
            {formatDuration(length)}
            {sound.category && <span> · {sound.category}</span>}
          </div>
        </div>
        <div className="-mt-1 -mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <button
            type="button"
            title={sound.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}
            onClick={stopPropagation(() => library.update(sound.id, { favorite: !sound.favorite }))}
            className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
          >
            <Star className={cn(sound.favorite && "fill-current text-[var(--tile)]")} />
          </button>
          <button
            type="button"
            title="Bearbeiten"
            onClick={stopPropagation(onEdit)}
            className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
          >
            <Pencil />
          </button>
        </div>
        {sound.favorite && (
          <Star className="absolute top-0.5 right-0.5 size-3 fill-current text-[var(--tile)] transition-opacity group-hover:opacity-0" />
        )}
      </div>

      <Waveform
        peaks={sound.waveform.filter((_, i) => i % 2 === 0)}
        color={color}
        progress={progress}
        trim={undefined}
        className="relative my-2 min-h-0 flex-1"
      />

      <div className="relative flex h-6 items-center justify-between gap-2">
        {sound.hotkey ? (
          <div className="flex gap-1">
            {hotkeyLabel(sound.hotkey).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </div>
        ) : (
          <span className="font-mono text-3xs text-muted-foreground/60">kein Hotkey</span>
        )}
        {playing && (
          <button
            type="button"
            title="Stoppen"
            onClick={stopPropagation(() => library.stop(sound.id))}
            className="flex size-6 cursor-default items-center justify-center rounded-full bg-[var(--tile)] text-black/80 [&_svg]:size-2.5"
          >
            <Square className="fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}
