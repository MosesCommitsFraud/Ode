import { MagnifyingGlass as SearchIcon, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Kbd } from "~/components/ui/misc";
import { library, useLibrary, type Sound } from "~/lib/library";
import { formatTime, music, useMusic, type Track } from "~/lib/music";
import { cn } from "~/lib/utils";
import { PlayGlyph } from "~/components/ui/transport";
import { t } from "~/lib/i18n";

const LIMIT = 6;

type Hit = { kind: "sound"; sound: Sound } | { kind: "track"; track: Track; queue: number[]; index: number };

/** Treffer zuerst, deren Name mit der Suche beginnt, dann alle, die sie enthalten. */
function rank<T>(items: T[], query: string, fields: (item: T) => (string | null)[]) {
  const q = query.toLowerCase();
  const scored: [number, T][] = [];
  for (const item of items) {
    const values = fields(item).filter(Boolean).map((v) => v!.toLowerCase());
    if (values[0]?.startsWith(q)) scored.push([0, item]);
    else if (values.some((v) => v.includes(q))) scored.push([1, item]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

/** Suche oben: findet Sounds und Titel, ein Klick spielt sie sofort. */
export function Search() {
  const sounds = useLibrary((s) => s.sounds);
  const soundsLoaded = useLibrary((s) => s.loaded);
  const tracks = useMusic((s) => s.tracks);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!soundsLoaded) void library.load();
    void music.init();
  }, [open, soundsLoaded]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const foundSounds = rank(sounds, q, (s) => [s.name, s.category]).slice(0, LIMIT);
    const foundTracks = rank(tracks, q, (t) => [t.title, t.artist]).slice(0, LIMIT);
    const queue = foundTracks.map((t) => t.id);
    return [
      ...foundSounds.map((sound): Hit => ({ kind: "sound", sound })),
      ...foundTracks.map((track, index): Hit => ({ kind: "track", track, queue, index })),
    ];
  }, [query, sounds, tracks]);

  useEffect(() => setActive(0), [query]);

  const key = (hit: Hit) => (hit.kind === "sound" ? `s${hit.sound.id}` : `t${hit.track.id}`);

  const play = (hit: Hit) => {
    if (hit.kind === "sound") void library.play(hit.sound.id);
    else void music.play(hit.queue, hit.index);
    setPlayed(key(hit));
    window.setTimeout(() => setPlayed((p) => (p === key(hit) ? null : p)), 900);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else {
        setOpen(false);
        input.current?.blur();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      play(hits[active]);
    } else return;
  };

  const showPanel = open && query.trim().length > 0;
  const firstTrack = hits.findIndex((h) => h.kind === "track");

  return (
    <div ref={root} className="relative w-full max-w-sm">
      <div
        className={cn(
          "panel flex h-9 items-center gap-2 rounded-full pr-1.5 pl-3.5 text-xs transition-shadow",
          open && "shadow-[var(--shadow-panel),0_0_0_2px_var(--ring)]",
        )}
      >
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("shell.searchPlaceholder")}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button
            type="button"
            title={t("shell.clear")}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            className="flex size-6 cursor-default items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
          >
            <X />
          </button>
        ) : (
          <Kbd className="rounded-full px-2">{t("shell.searchKey")}</Kbd>
        )}
      </div>

      {showPanel && (
        <div className="absolute top-full right-0 left-0 z-50 mt-2 animate-[pop-in_140ms_var(--ease-drawer)] overflow-hidden rounded-2xl border border-hairline bg-popover p-1.5 shadow-pop">
          {hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t("shell.nothingFound")}</div>
          ) : (
            hits.map((hit, i) => {
              const sound = hit.kind === "sound" ? hit.sound : null;
              const track = hit.kind === "track" ? hit.track : null;
              const justPlayed = played === key(hit);
              return (
                <div key={key(hit)}>
                  {(i === 0 || i === firstTrack) && (
                    <div className="px-2.5 pt-1.5 pb-1 font-mono text-3xs tracking-[0.16em] text-muted-foreground uppercase">
                      {sound ? t("shell.sounds") : t("shell.music")}
                    </div>
                  )}
                  <button
                    type="button"
                    onPointerMove={() => setActive(i)}
                    onClick={() => play(hit)}
                    className={cn(
                      "group flex h-11 w-full cursor-default items-center gap-3 rounded-xl px-2.5 text-left transition-colors",
                      i === active && "bg-accent",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{sound?.name ?? track!.title}</div>
                      <div className="truncate text-2xs text-muted-foreground">
                        {sound ? (sound.category ?? formatTime(sound.durationMs)) : (track!.artist ?? formatTime(track!.durationMs))}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full transition-all [&_svg]:size-3.5",
                        justPlayed
                          ? "scale-110 bg-primary text-primary-foreground"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100",
                        i === active && "opacity-100",
                      )}
                    >
                      <PlayGlyph />
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
