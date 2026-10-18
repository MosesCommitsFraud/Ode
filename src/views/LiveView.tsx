import { ArrowsClockwise, Broadcast } from "@phosphor-icons/react";
import { useEffect } from "react";
import { PageChannel } from "~/components/mixer/PageChannel";
import { Meter } from "~/components/mixer/Meter";
import { Button } from "~/components/ui/button";
import { EmptyState, Card } from "~/components/ui/misc";
import { live, useLive, type AppSource } from "~/lib/live";
import { useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

/** Wie oft die Liste der Programme neu gelesen wird, damit „spielt“ stimmt. */
const REFRESH_MS = 4000;

function SourceRow({ source, active }: { source: AppSource; active: boolean }) {
  return (
    <div
      className={cn(
        "grid h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-xl px-3 transition-colors",
        active ? "bg-[color-mix(in_oklch,var(--ch-live)_12%,transparent)]" : "hover:bg-accent",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{source.name}</div>
        <div className="truncate font-mono text-3xs text-muted-foreground">{source.exe}</div>
      </div>
      <span
        className={cn(
          "font-mono text-3xs font-semibold uppercase",
          source.playing ? "text-success-foreground" : "text-muted-foreground/60",
        )}
      >
        {source.playing ? "spielt" : "still"}
      </span>
      {active ? (
        <Button variant="outline" size="sm" onClick={() => void live.stop()}>
          Beenden
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => void live.start(source)}>
          Live schalten
        </Button>
      )}
    </div>
  );
}

function ActiveSource({ source }: { source: AppSource }) {
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === "live")?.peak ?? 0) : 0));
  const muted = useStore((s) => s.channels.live.muted);
  return (
    <Card className="flex items-center gap-5 p-5 [--ch:var(--ch-live)]">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-3xs font-semibold tracking-[0.16em] text-[var(--ch-live)] uppercase">Live</div>
        <div className="mt-1 truncate font-display text-2xl font-semibold tracking-tight">{source.name}</div>
        <Meter peak={muted ? 0 : peak} orientation="horizontal" className="mt-3 h-2.5" />
      </div>
      <Button onClick={() => void live.stop()}>
        Beenden
      </Button>
    </Card>
  );
}

export function LiveView() {
  const sources = useLive((s) => s.sources);
  const active = useLive((s) => s.active);
  const loading = useLive((s) => s.loading);
  const error = useLive((s) => s.error);

  useEffect(() => {
    void live.refresh();
    const timer = window.setInterval(() => void live.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Programme, die gerade spielen, stehen oben.
  const sorted = [...sources].sort((a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name));

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] gap-4 overflow-hidden pl-6 pr-3 pt-3 pb-3">
      <div className="flex min-h-0 flex-col gap-4">
        {active && <ActiveSource source={active} />}

        <Card className="flex min-h-0 flex-1 flex-col p-3">
          <div className="flex h-10 items-center justify-between px-2 pb-1">
            <h2 className="font-display text-lg font-semibold tracking-tight">Programme</h2>
            <Button variant="ghost" size="icon-sm" title="Neu einlesen" onClick={() => void live.refresh()}>
              <ArrowsClockwise className={cn(loading && "animate-spin")} />
            </Button>
          </div>
          {error && <p className="px-3 pb-2 text-sm text-error-foreground">{error}</p>}
          <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
            {sorted.length === 0 && !loading ? (
              <EmptyState art="sounds" title="Gerade spielt kein Programm Ton" />
            ) : (
              sorted.map((source) => (
                <SourceRow key={source.pid} source={source} active={active?.pid === source.pid} />
              ))
            )}
          </div>
        </Card>
      </div>

      <PageChannel id="live" name="Live" icon={<Broadcast />} color="var(--ch-live)" />
    </div>
  );
}
