import { convertFileSrc } from "@tauri-apps/api/core";
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CircleNotch as Loader2,
  ListPlus,
  Pause,
  Play,
  Plus,
  Shuffle,
  Trash as Trash2,
  VinylRecord,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/misc";
import { isTauri } from "~/lib/engine";
import { formatTime, music, tracksOf, useMusic, type Track } from "~/lib/music";
import { cn } from "~/lib/utils";

const ROW_HEIGHT = 56;

/** Wie viele Zeilen passen in den Bereich? Die Seite selbst scrollt nie. */
function useRowCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(8);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setRows(Math.max(1, Math.floor(entry.contentRect.height / ROW_HEIGHT))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, rows };
}

function useFileDrop(onDrop: (paths: string[]) => void) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const { type } = event.payload;
          if (type === "enter" || type === "over") setOver(true);
          else if (type === "leave") setOver(false);
          else if (type === "drop") {
            setOver(false);
            onDrop(event.payload.paths);
          }
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onDrop]);
  return over;
}

/** Kleines Menü „Zu Playlist hinzufügen“ am Knopf. */
function AddToPlaylist({ track, anchor, onClose }: { track: Track; anchor: DOMRect; onClose: () => void }) {
  const playlists = useMusic((s) => s.playlists);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 w-56 rounded-xl bg-popover p-1 shadow-[var(--shadow-pop)]"
      style={{ top: anchor.bottom + 6, left: Math.max(8, anchor.right - 224) }}
    >
      <div className="px-2.5 pt-1.5 pb-1 font-mono text-3xs text-muted-foreground uppercase">Zu Playlist</div>
      {playlists.length === 0 && (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">Noch keine Playlists.</p>
      )}
      {playlists.map((p) => {
        const has = p.trackIds.includes(track.id);
        return (
          <button
            key={p.id}
            type="button"
            disabled={has}
            onClick={() => {
              void music.addToPlaylist(p.id, track.id);
              onClose();
            }}
            className="flex h-8 w-full cursor-default items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span className="truncate">{p.name}</span>
            {has && <span className="font-mono text-3xs text-muted-foreground">drin</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function TrackRow({
  track,
  number,
  current,
  playing,
  inPlaylist,
  onPlay,
}: {
  track: Track;
  number: number;
  current: boolean;
  playing: boolean;
  inPlaylist: boolean;
  onPlay: () => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [confirm, setConfirm] = useState(false);
  const selected = useMusic((s) => s.selectedPlaylist);
  const playlist = useMusic((s) => s.playlists.find((p) => p.id === s.selectedPlaylist));

  const [coverFailed, setCoverFailed] = useState(false);
  const cover = track.cover && isTauri && !coverFailed ? convertFileSrc(track.cover) : null;

  return (
    <div
      onDoubleClick={onPlay}
      onMouseLeave={() => setConfirm(false)}
      className={cn(
        "group grid h-full grid-cols-[1.75rem_2.5rem_minmax(0,1fr)_auto_3rem] items-center gap-3 rounded-xl px-2 transition-colors",
        current ? "bg-[color-mix(in_oklch,var(--ch-music)_9%,transparent)]" : "hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "text-right font-mono text-2xs tabular-nums",
          current ? "text-[var(--ch-music)]" : "text-muted-foreground",
        )}
      >
        {number}
      </span>
      <button
        type="button"
        title={current && playing ? "Pause" : "Abspielen"}
        onClick={() => (current ? music.toggle() : onPlay())}
        className="relative flex size-10 cursor-default items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground shadow-[0_0_0_1px_var(--hairline)] [&_svg]:size-4"
      >
        {cover ? (
          <img src={cover} alt="" draggable={false} onError={() => setCoverFailed(true)} className="size-full object-cover" />
        ) : (
          <VinylRecord className={cn(current && "text-[var(--ch-music)]")} />
        )}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/55 text-white transition-opacity",
            current ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {current && playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </span>
      </button>
      <div className="min-w-0">
        <div className={cn("truncate text-sm font-semibold", current && "text-[var(--ch-music)]")} title={track.title}>
          {track.title}
        </div>
        {track.artist && <div className="truncate text-2xs text-muted-foreground">{track.artist}</div>}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Zu Playlist hinzufügen"
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        >
          <ListPlus />
        </Button>
        {inPlaylist && playlist ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Aus Playlist entfernen"
            onClick={() =>
              music.setPlaylistTracks(
                playlist.id,
                playlist.trackIds.filter((id) => id !== track.id),
              )
            }
          >
            <X />
          </Button>
        ) : (
          selected === null && (
            <Button
              variant={confirm ? "destructive" : "ghost"}
              size={confirm ? "sm" : "icon-sm"}
              title="Titel löschen"
              onClick={() => (confirm ? music.deleteTrack(track.id) : setConfirm(true))}
            >
              <Trash2 />
              {confirm && "Löschen?"}
            </Button>
          )
        )}
      </div>
      <span className="text-right font-mono text-2xs text-muted-foreground tabular-nums">
        {formatTime(track.durationMs)}
      </span>
      {menu && <AddToPlaylist track={track} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}


export function MusicView() {
  const tracks = useMusic((s) => s.tracks);
  const playlists = useMusic((s) => s.playlists);
  const loaded = useMusic((s) => s.loaded);
  const importing = useMusic((s) => s.importing);
  const notices = useMusic((s) => s.notices);
  const selected = useMusic((s) => s.selectedPlaylist);
  const player = useMusic((s) => s.player);

  const [page, setPage] = useState(0);
  const { ref, rows } = useRowCount();
  const dragOver = useFileDrop(music.importFiles);

  useEffect(() => {
    void music.init();
  }, []);
  useEffect(() => setPage(0), [selected]);

  const playlist = playlists.find((p) => p.id === selected);
  const list = useMemo(() => tracksOf({ tracks, playlists }, selected), [tracks, playlists, selected]);
  const ids = list.map((t) => t.id);
  const pages = Math.max(1, Math.ceil(list.length / rows));
  const current = Math.min(page, pages - 1);
  const shown = list.slice(current * rows, (current + 1) * rows);
  const turn = (delta: number) => setPage(Math.min(pages - 1, Math.max(0, current + delta)));
  const total = list.reduce((sum, t) => sum + t.durationMs, 0);

  // Läuft gerade ein Titel aus genau dieser Liste?
  const listPlaying = player.track !== null && ids.includes(player.track.id) && player.playing;

  const onWheel = (e: WheelEvent) => {
    if (pages > 1 && Math.abs(e.deltaY) > 20) turn(e.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="relative flex h-full gap-4 px-6 pt-5 pb-4">
      {/* Titel */}
      <section className="panel flex min-w-0 flex-1 flex-col rounded-2xl p-4">
        <div className="flex items-center gap-3 pb-3">
          <div className="min-w-0 flex-1">
            {playlist ? (
              <input
                key={playlist.id}
                defaultValue={playlist.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== playlist.name) void music.renamePlaylist(playlist.id, name);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                aria-label="Name der Playlist (klicken zum Umbenennen)"
                title="Klicken zum Umbenennen"
                className="w-full truncate bg-transparent font-display text-2xl font-semibold tracking-tight outline-none"
              />
            ) : (
              <h2 className="font-display text-2xl font-semibold tracking-tight">Alle Titel</h2>
            )}
            <p className="font-mono text-3xs text-muted-foreground uppercase">
              {list.length} Titel · {formatTime(total)}
            </p>
          </div>
          <Button
            size="sm"
            disabled={list.length === 0}
            onClick={() => (listPlaying ? music.toggle() : music.play(ids, 0))}
          >
            {listPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
            {listPlaying ? "Pause" : "Abspielen"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={list.length === 0}
            title="Zufällig abspielen"
            onClick={async () => {
              await music.setShuffle(true);
              await music.play(ids, Math.floor(Math.random() * ids.length));
            }}
          >
            <Shuffle /> Zufällig
          </Button>
          <Button variant="outline" size="sm" onClick={() => music.pickFiles()}>
            {importing > 0 ? <Loader2 className="animate-spin" /> : <Plus />}
            {importing > 0 ? `Lade ${importing} …` : "Musik hinzufügen"}
          </Button>
          {playlist && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Playlist löschen (Titel bleiben erhalten)"
              onClick={() => music.deletePlaylist(playlist.id)}
            >
              <Trash2 />
            </Button>
          )}
        </div>

        {notices.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {notices.map((n, i) => (
              <div key={`${i}-${n}`} className="flex items-center gap-3 rounded-xl bg-error/10 px-3 py-2 text-sm text-error-foreground">
                <span className="flex-1">{n}</span>
                <button type="button" onClick={() => music.dismissNotice(i)} className="cursor-default opacity-70 hover:opacity-100">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div ref={ref} onWheel={onWheel} className="min-h-0 flex-1 overflow-hidden">
          {loaded && list.length === 0 ? (
            <EmptyState
              art={playlist ? "playlist" : "music"}
              title={playlist ? "Diese Playlist hat Lampenfieber" : "Hier herrscht Funkstille"}
            />
          ) : (
            <div className="grid" style={{ gridAutoRows: ROW_HEIGHT }}>
              {shown.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  number={current * rows + i + 1}
                  current={player.track?.id === track.id}
                  playing={player.playing}
                  inPlaylist={playlist !== undefined}
                  onPlay={() => music.play(ids, current * rows + i)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center justify-center gap-3">
          {pages > 1 && (
            <>
              <Button variant="ghost" size="icon-sm" title="Vorherige Seite" disabled={current === 0} onClick={() => turn(-1)}>
                <ChevronLeft />
              </Button>
              <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                Seite {current + 1} / {pages}
              </span>
              <Button variant="ghost" size="icon-sm" title="Nächste Seite" disabled={current === pages - 1} onClick={() => turn(1)}>
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
      </section>

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[var(--ch-music)] bg-[color-mix(in_oklch,var(--ch-music)_10%,transparent)] backdrop-blur-sm">
          <p className="font-display text-lg font-semibold">
            {playlist ? `Loslassen fügt zu „${playlist.name}“ hinzu` : "Loslassen zum Hinzufügen"}
          </p>
        </div>
      )}
    </div>
  );
}
