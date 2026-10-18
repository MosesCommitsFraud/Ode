import { CaretLeft as ChevronLeft, CaretRight as ChevronRight, CircleNotch as Loader2, Play, Rows, SquaresFour, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { SoundEditor } from "~/components/soundboard/SoundEditor";
import { SoundRow, SoundTile } from "~/components/soundboard/SoundTile";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/misc";
import { isTauri } from "~/lib/engine";
import { library, useLibrary } from "~/lib/library";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const ALL = "__all";
const FAVORITES = "__favorites";

/** Kachelmaße für die Seitenaufteilung; die Seite scrollt nie. */
const TILE_MIN_WIDTH = 176;
const TILE_HEIGHT = 116;
const GAP = 12;
const ROW_HEIGHT = 52;
const ROW_GAP = 4;

type Layout = "grid" | "list";
const LAYOUT_KEY = "ode.soundboard.layout";

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** Wie viele Kacheln passen in den Bereich? */
function useGridSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cols: 4, rows: 3, listRows: 8 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({
        cols: Math.max(1, Math.floor((width + GAP) / (TILE_MIN_WIDTH + GAP))),
        rows: Math.max(1, Math.floor((height + GAP) / (TILE_HEIGHT + GAP))),
        listRows: Math.max(1, Math.floor((height + ROW_GAP) / (ROW_HEIGHT + ROW_GAP))),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** Dateien aus dem Explorer aufs Fenster ziehen. */
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 cursor-default items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors [&_svg]:size-3.5",
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function SoundboardView() {
  const sounds = useLibrary((s) => s.sounds);
  const loaded = useLibrary((s) => s.loaded);
  const importing = useLibrary((s) => s.importing);
  const notices = useLibrary((s) => s.notices);
  const playing = useStore((s) => s.meters?.playing);
  const running = useStore((s) => s.info !== null);
  const starting = useStore((s) => s.starting);

  const [filter, setFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const dragOver = useFileDrop(library.importFiles);
  const grid = useGridSize();
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };

  useEffect(() => {
    if (!loaded) void library.load();
  }, [loaded]);

  const categories = useMemo(
    () => [...new Set(sounds.map((s) => s.category).filter((c): c is string => !!c))].sort(),
    [sounds],
  );
  const progress = useMemo(() => new Map(playing?.map((p) => [p.id, p.progress])), [playing]);

  const visible = sounds.filter((s) => {
    if (filter === FAVORITES && !s.favorite) return false;
    if (filter !== ALL && filter !== FAVORITES && s.category !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q);
  });
  const editingSound = sounds.find((s) => s.id === editing);

  const pageSize = layout === "list" ? grid.listRows : grid.cols * grid.rows;
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * pageSize, (current + 1) * pageSize);
  const turn = (delta: number) => setPage(Math.min(pages - 1, Math.max(0, current + delta)));

  // Neue Auswahl beginnt auf der ersten Seite.
  useEffect(() => setPage(0), [filter, query, layout]);

  const onWheel = (e: WheelEvent) => {
    if (pages > 1 && Math.abs(e.deltaY) > 20) turn(e.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-4">
        <div className="well flex h-9 w-56 items-center gap-2 rounded-full px-3.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sound suchen"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="cursor-default text-muted-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          <Chip active={filter === ALL} onClick={() => setFilter(ALL)}>
            Alle <span className="font-mono opacity-60">{sounds.length}</span>
          </Chip>
          <Chip active={filter === FAVORITES} onClick={() => setFilter(FAVORITES)}>
            Favoriten
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="well flex h-8 rounded-full p-0.5">
          {(
            [
              ["grid", "Kacheln", <SquaresFour key="g" />],
              ["list", "Liste", <Rows key="l" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-pressed={layout === value}
              onClick={() => setLayout(value)}
              className={cn(
                "flex w-9 cursor-default items-center justify-center rounded-full transition-colors [&_svg]:size-4",
                layout === value ? "bg-panel-raised text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {icon}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={!playing?.length} onClick={() => library.stopAll()}>
          Alle stoppen
        </Button>
        <Button size="sm" onClick={() => library.pickFiles()}>
          {importing > 0 && <Loader2 className="animate-spin" />}
          {importing > 0 ? `Lade ${importing} …` : "Sounds hinzufügen"}
        </Button>
      </div>

      {!running && sounds.length > 0 && (
        <div className="mx-6 mb-4 flex items-center gap-3 rounded-2xl bg-warning/12 px-4 py-2.5 text-sm text-warning-foreground">
          <span className="flex-1">Die Engine ist aus – Sounds sind erst zu hören, wenn sie läuft.</span>
          <Button size="sm" disabled={starting} onClick={() => actions.start()}>
            <Play /> {starting ? "Startet …" : "Engine starten"}
          </Button>
        </div>
      )}

      {notices.length > 0 && (
        <div className="mx-6 mb-4 space-y-1.5">
          {notices.map((n, i) => (
            <div key={`${i}-${n}`} className="flex items-center gap-3 rounded-2xl bg-error/10 px-4 py-2 text-sm text-error-foreground">
              <span className="flex-1">{n}</span>
              <button type="button" onClick={() => library.dismissNotice(i)} className="cursor-default opacity-70 hover:opacity-100">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={grid.ref} onWheel={onWheel} className="min-h-0 flex-1 overflow-hidden px-6">
        {sounds.length === 0 && loaded ? (
          <EmptyState art="sounds" title="Noch kein einziges Airhorn">
            Zieh Audiodateien hier rein.
          </EmptyState>
        ) : visible.length === 0 && loaded ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">Keine Sounds für diese Auswahl.</p>
        ) : layout === "list" ? (
          <div className="grid" style={{ gap: ROW_GAP, gridAutoRows: ROW_HEIGHT }}>
            {shown.map((sound) => (
              <SoundRow
                key={sound.id}
                sound={sound}
                progress={progress.get(sound.id)}
                onEdit={() => setEditing(sound.id)}
              />
            ))}
          </div>
        ) : (
          <div
            className="grid"
            style={{
              gap: GAP,
              gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
              gridAutoRows: TILE_HEIGHT,
            }}
          >
            {shown.map((sound) => (
              <SoundTile
                key={sound.id}
                sound={sound}
                progress={progress.get(sound.id)}
                onEdit={() => setEditing(sound.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex h-12 shrink-0 items-center justify-center gap-3 px-6">
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

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <p className="font-display text-lg font-semibold">Loslassen zum Hinzufügen</p>
        </div>
      )}

      {editingSound && (
        <SoundEditor
          key={editingSound.id}
          sound={editingSound}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
