import { PencilSimple, Play, Stop, Star } from "@phosphor-icons/react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Kbd } from "~/components/ui/misc";
import { library, soundColor, type Sound } from "~/lib/library";
import { cn } from "~/lib/utils";
import { hotkeyLabel } from "./hotkey";
import { Waveform } from "./Waveform";

function formatDuration(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function soundLength(sound: Sound) {
  return (sound.trimEndMs || sound.durationMs) - Math.min(sound.trimStartMs, sound.durationMs);
}

interface ItemProps {
  sound: Sound;
  /** Fortschritt 0–1, wenn der Sound gerade läuft. */
  progress: number | undefined;
  onEdit: () => void;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** Klick spielt, Rechtsklick bearbeitet, Enter und Leertaste spielen. */
function playableProps(sound: Sound, onEdit: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => void library.play(sound.id),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      onEdit();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void library.play(sound.id);
      }
    },
  };
}

function ActionButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={stop(onClick)}
      className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function Actions({ sound, onEdit }: { sound: Sound; onEdit: () => void }) {
  return (
    <>
      <ActionButton
        title={sound.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}
        onClick={() => void library.update(sound.id, { favorite: !sound.favorite })}
      >
        <Star weight={sound.favorite ? "fill" : "bold"} className={cn(sound.favorite && "text-[var(--tile)]")} />
      </ActionButton>
      <ActionButton title="Bearbeiten" onClick={onEdit}>
        <PencilSimple />
      </ActionButton>
    </>
  );
}

function Hotkey({ sound }: { sound: Sound }) {
  if (!sound.hotkey) return null;
  return (
    <div className="flex gap-1">
      {hotkeyLabel(sound.hotkey).map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </div>
  );
}

/** Kachel im Raster: Titel über die ganze Breite, Aktionen erscheinen beim Hovern darüber. */
export function SoundTile({ sound, progress, onEdit }: ItemProps) {
  const color = soundColor(sound.color);
  const playing = progress !== undefined;

  return (
    <div
      {...playableProps(sound, onEdit)}
      style={{ "--tile": color } as CSSProperties}
      className={cn(
        "group panel relative flex h-full cursor-default flex-col overflow-hidden rounded-2xl p-3 text-left outline-none transition-transform duration-150 select-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98]",
        playing && "shadow-[inset_0_0_0_1.5px_var(--tile)]",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight font-semibold" title={sound.name}>
          {sound.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-3xs text-muted-foreground tabular-nums">
          {sound.favorite && <Star weight="fill" className="size-2.5 shrink-0 text-[var(--tile)]" />}
          {formatDuration(soundLength(sound))}
          {sound.category && <span className="truncate">· {sound.category}</span>}
        </div>
      </div>

      <div className="absolute top-2 right-2 flex rounded-xl bg-panel-raised p-0.5 opacity-0 shadow-[0_0_0_1px_var(--hairline),0_4px_12px_-4px_oklch(0%_0_0/35%)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Actions sound={sound} onEdit={onEdit} />
      </div>

      <Waveform
        peaks={sound.waveform.filter((_, i) => i % 2 === 0)}
        color={color}
        progress={progress}
        trim={undefined}
        className="relative my-2 min-h-0 flex-1"
      />

      <div className="flex h-6 items-center justify-between gap-2">
        <Hotkey sound={sound} />
        {playing && (
          <button
            type="button"
            title="Stoppen"
            onClick={stop(() => void library.stop(sound.id))}
            className="ml-auto flex size-6 cursor-default items-center justify-center rounded-full bg-[var(--tile)] text-black/80 [&_svg]:size-3"
          >
            <Stop weight="fill" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Zeile in der Listenansicht: Abspielknopf, Name, Wellenform, Länge, Hotkey, Aktionen. */
export function SoundRow({ sound, progress, onEdit }: ItemProps) {
  const color = soundColor(sound.color);
  const playing = progress !== undefined;

  return (
    <div
      {...playableProps(sound, onEdit)}
      style={{ "--tile": color } as CSSProperties}
      className={cn(
        "group grid h-full cursor-default grid-cols-[2.25rem_minmax(0,1fr)_minmax(6rem,14rem)_3.5rem_8rem_4.25rem] items-center gap-4 rounded-xl px-2 outline-none transition-colors select-none",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        playing && "bg-[color-mix(in_oklch,var(--tile)_10%,transparent)]",
      )}
    >
      <button
        type="button"
        title={playing ? "Stoppen" : "Abspielen"}
        onClick={stop(() => void (playing ? library.stop(sound.id) : library.play(sound.id)))}
        className={cn(
          "flex size-9 cursor-default items-center justify-center rounded-xl transition-colors [&_svg]:size-4",
          playing
            ? "bg-[var(--tile)] text-black/80"
            : "bg-[color-mix(in_oklch,var(--tile)_16%,transparent)] text-[var(--tile)] group-hover:bg-[var(--tile)] group-hover:text-black/80",
        )}
      >
        {playing ? <Stop weight="fill" /> : <Play weight="fill" />}
      </button>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold" title={sound.name}>
            {sound.name}
          </span>
          {sound.favorite && <Star weight="fill" className="size-3 shrink-0 text-[var(--tile)]" />}
        </div>
        {sound.category && <div className="truncate text-2xs text-muted-foreground">{sound.category}</div>}
      </div>

      <Waveform
        peaks={sound.waveform.filter((_, i) => i % 3 === 0)}
        color={color}
        progress={progress}
        trim={undefined}
        className="h-7"
      />

      <span className="text-right font-mono text-2xs text-muted-foreground tabular-nums">
        {formatDuration(soundLength(sound))}
      </span>

      <div className="flex justify-end">
        <Hotkey sound={sound} />
      </div>

      <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Actions sound={sound} onEdit={onEdit} />
      </div>
    </div>
  );
}
