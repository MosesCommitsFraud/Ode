import {
  CaretDown,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CircleNotch as Loader2,
  MagnifyingGlass,
  Plus,
  Rows,
  SquaresFour,
  Star,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { PageChannel } from "~/components/mixer/PageChannel";
import { SoundEditor } from "~/components/soundboard/SoundEditor";
import { SoundRow, SoundTile } from "~/components/soundboard/SoundTile";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/misc";
import { isTauri } from "~/lib/engine";
import { library, matchesFilter, useLibrary, type SoundFilter } from "~/lib/library";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { ActionGroup, ActionPill, Pill, PillGroup } from "~/components/ui/pills";
import { PlayGlyph, StopGlyph } from "~/components/ui/transport";


/** Kachelmaße für die Seitenaufteilung; die Seite scrollt nie. */
const TILE_MIN_WIDTH = 176;
const TILE_HEIGHT = 116;
const GAP = 12;
const ROW_HEIGHT = 40;
const ROW_GAP = 2;

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

/**
 * Filter: „Alle“ und „Favoriten“ direkt, Kategorien in einem Menü mit Suche,
 * damit auch viele Kategorien Platz haben.
 */
function FilterBar({ categories }: { categories: { name: string; count: number }[] }) {
  const filter = useLibrary((s) => s.filter);
  const total = useLibrary((s) => s.sounds.length);
  const favorites = useLibrary((s) => s.sounds.filter((x) => x.favorite).length);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const category = filter.kind === "category" ? filter.name : null;
  const found = categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const pick = (next: SoundFilter) => {
    library.setFilter(next);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={root} className="relative">
      <PillGroup>
        <Pill active={filter.kind === "all"} onClick={() => pick({ kind: "all" })}>
          Alle <span className="font-mono opacity-60">{total}</span>
        </Pill>
        <Pill active={filter.kind === "favorites"} onClick={() => pick({ kind: "favorites" })}>
          <Star weight={filter.kind === "favorites" ? "fill" : "bold"} />
          Favoriten <span className="font-mono opacity-60">{favorites}</span>
        </Pill>
        {categories.length > 0 && (
          <Pill
            active={category !== null}
            aria-expanded={open}
            className="max-w-48"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="truncate">{category ?? "Kategorie"}</span>
            <CaretDown className={cn("transition-transform", open && "rotate-180")} />
          </Pill>
        )}
      </PillGroup>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 w-64 animate-[pop-in_140ms_var(--ease-drawer)] rounded-2xl border border-hairline bg-popover p-1.5 shadow-pop">
          <div className="well mb-1 flex h-8 items-center gap-2 rounded-lg px-2.5">
            <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && found[0]) pick({ kind: "category", name: found[0].name });
              }}
              placeholder="Kategorie suchen"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {found.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">Keine Kategorie gefunden.</p>
            ) : (
              found.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => pick({ kind: "category", name: c.name })}
                  className={cn(
                    "flex h-8 w-full cursor-default items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-accent",
                    category === c.name && "font-semibold text-primary",
                  )}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="font-mono text-3xs text-muted-foreground tabular-nums">{c.count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
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

  const filter = useLibrary((s) => s.filter);
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
  const categoryCounts = useMemo(
    () => categories.map((name) => ({ name, count: sounds.filter((s) => s.category === name).length })),
    [categories, sounds],
  );
  const progress = useMemo(() => new Map(playing?.map((p) => [p.id, p.progress])), [playing]);

  const visible = sounds.filter((s) => {
    if (!matchesFilter(s, filter)) return false;
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
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pl-6 pr-3 pt-3 pb-4">
        <div className="well flex h-9 w-40 min-w-0 shrink items-center gap-2 rounded-full px-3.5">
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
        <FilterBar categories={categoryCounts} />
        <div className="flex-1" />
        <PillGroup>
          <Pill active={layout === "grid"} title="Kacheln" className="px-2.5" onClick={() => setLayout("grid")}>
            <SquaresFour className="!size-4" />
          </Pill>
          <Pill active={layout === "list"} title="Liste" className="px-2.5" onClick={() => setLayout("list")}>
            <Rows className="!size-4" />
          </Pill>
        </PillGroup>
        <ActionGroup>
          <ActionPill disabled={!playing?.length} onClick={() => library.stopAll()}>
            <StopGlyph /> Alle stoppen
          </ActionPill>
          <ActionPill primary onClick={() => library.pickFiles()}>
            {importing > 0 ? <Loader2 className="animate-spin" /> : <Plus />}
            {importing > 0 ? `Lade ${importing} …` : "Hinzufügen"}
          </ActionPill>
        </ActionGroup>
      </div>

      {!running && sounds.length > 0 && (
        <div className="mr-3 ml-6 mb-4 flex items-center gap-3 rounded-2xl bg-warning/12 px-4 py-2.5 text-sm text-warning-foreground">
          <span className="flex-1">Die Engine ist aus – Sounds sind erst zu hören, wenn sie läuft.</span>
          <Button size="sm" disabled={starting} onClick={() => actions.start()}>
            <PlayGlyph /> {starting ? "Startet …" : "Engine starten"}
          </Button>
        </div>
      )}

      {notices.length > 0 && (
        <div className="mr-3 ml-6 mb-4 space-y-1.5">
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

      <div ref={grid.ref} onWheel={onWheel} className="min-h-0 flex-1 overflow-hidden pr-3 pl-6">
        {sounds.length === 0 && loaded ? (
          <EmptyState art="sounds" title="Noch kein einziges Airhorn">
            Zieh Audiodateien hier rein.
          </EmptyState>
        ) : visible.length === 0 && loaded ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">Keine Sounds für diese Auswahl.</p>
        ) : layout === "list" ? (
          <div
            key="list"
            className="grid animate-[layout-in_260ms_var(--ease-drawer)]"
            style={{ gap: ROW_GAP, gridAutoRows: ROW_HEIGHT }}
          >
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
            key="grid"
            className="grid animate-[layout-in_260ms_var(--ease-drawer)]"
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

      <div className="flex h-12 shrink-0 items-center justify-center gap-3 pr-3 pl-6">
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

      </div>

      <div className="flex shrink-0 py-3 pr-3">
        <PageChannel id="soundboard" name="Soundboard" icon={<Waveform />} color="var(--ch-soundboard)" />
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
