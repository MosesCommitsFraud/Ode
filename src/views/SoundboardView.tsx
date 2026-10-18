import { LayoutGrid, Loader2, Play, Plus, Search, Square, Star, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SoundEditor } from "~/components/soundboard/SoundEditor";
import { SoundTile } from "~/components/soundboard/SoundTile";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/misc";
import { isTauri } from "~/lib/engine";
import { library, useLibrary } from "~/lib/library";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const ALL = "__all";
const FAVORITES = "__favorites";

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
  const dragOver = useFileDrop(library.importFiles);

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

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-4">
        <div className="well flex h-9 w-56 items-center gap-2 rounded-full px-3.5">
          <Search className="size-3.5 text-muted-foreground" />
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
            <Star /> Favoriten
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={!playing?.length} onClick={() => library.stopAll()}>
          <Square /> Alle stoppen
        </Button>
        <Button size="sm" onClick={() => library.pickFiles()}>
          {importing > 0 ? <Loader2 className="animate-spin" /> : <Plus />}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {sounds.length === 0 && loaded ? (
          <EmptyState icon={<LayoutGrid />} title="Noch keine Sounds">
            Zieh Audiodateien (MP3, WAV, OGG, FLAC …) hierher oder klick auf „Sounds hinzufügen“. Klick
            auf eine Kachel spielt sie ab, Rechtsklick öffnet die Einstellungen.
          </EmptyState>
        ) : visible.length === 0 && loaded ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">Keine Sounds für diese Auswahl.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {visible.map((sound) => (
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

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <Upload className="size-8 text-primary" />
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
