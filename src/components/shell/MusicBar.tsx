import { Music, Pause, Repeat, Shuffle, SkipBack, SkipForward, Volume1 } from "lucide-react";
import { Button } from "~/components/ui/button";

/** Unten angedockte Musik-Leiste wie der Eingabebereich in T3 Code. */
export function MusicBar() {
  return (
    <div className="px-4 pb-3">
      <div className="mx-auto flex h-14 items-center gap-4 rounded-xl border border-border bg-card px-3 shadow-dock">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Music className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm">Nichts in der Wiedergabe</div>
            <div className="truncate text-2xs text-muted-foreground">Musik-Player folgt in Phase 3</div>
          </div>
        </div>

        <div className="flex flex-[1.4] flex-col items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" disabled title="Zufällig">
              <Shuffle />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled title="Zurück">
              <SkipBack />
            </Button>
            <Button variant="secondary" size="icon-sm" disabled title="Pause" className="rounded-full">
              <Pause />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled title="Weiter">
              <SkipForward />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled title="Wiederholen">
              <Repeat />
            </Button>
          </div>
          <div className="flex w-full max-w-md items-center gap-2 font-mono text-3xs text-muted-foreground tabular-nums">
            <span>0:00</span>
            <div className="h-1 flex-1 rounded-full bg-meter-track" />
            <span>0:00</span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 text-muted-foreground">
          <Volume1 className="size-4" />
          <div className="h-1 w-24 rounded-full bg-meter-track">
            <div className="h-full w-2/3 rounded-full bg-muted-foreground/40" />
          </div>
        </div>
      </div>
    </div>
  );
}
