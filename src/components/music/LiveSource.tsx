import { Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { live, useLive } from "~/lib/live";
import { cn } from "~/lib/utils";

/**
 * Knopf „Live“: legt den Ton eines laufenden Programms (Spotify, Browser, …)
 * auf den Musik-Kanal. Windows trennt nach Programmen, nicht nach Tabs.
 */
export function LiveSource() {
  const active = useLive((s) => s.active);
  const sources = useLive((s) => s.sources);
  const loading = useLive((s) => s.loading);
  const error = useLive((s) => s.error);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void live.refresh();
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  const open = () => {
    void live.refresh();
    setAnchor(button.current?.getBoundingClientRect() ?? null);
  };

  return (
    <>
      <div className="flex items-center">
        <Button
          ref={button}
          variant={active ? "secondary" : "outline"}
          size="sm"
          title="Ton eines Programms live übernehmen"
          onClick={() => (anchor ? setAnchor(null) : open())}
          className={cn(active && "rounded-r-none text-[var(--ch-music)]")}
        >
          {active ? `Live: ${active.name}` : "Live"}
        </Button>
        {active && (
          <Button
            variant="secondary"
            size="sm"
            title="Live-Quelle beenden"
            onClick={() => live.stop()}
            className="rounded-l-none border-l border-border px-2"
          >
            <X />
          </Button>
        )}
      </div>

      {anchor &&
        createPortal(
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed z-50 w-64 rounded-xl bg-popover p-1 shadow-[var(--shadow-pop)]"
            style={{ top: anchor.bottom + 6, left: Math.max(8, anchor.right - 256) }}
          >
            <div className="flex h-8 items-center justify-between px-2.5">
              <span className="font-mono text-3xs text-muted-foreground uppercase">Programme</span>
              <button
                type="button"
                title="Neu laden"
                onClick={() => live.refresh()}
                className="flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
              >
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </button>
            </div>
            {sources.length === 0 && !loading && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">Gerade spielt kein Programm Ton ab.</p>
            )}
            {sources.map((s) => (
              <button
                key={s.pid}
                type="button"
                onClick={() => {
                  void live.start(s);
                  setAnchor(null);
                }}
                className={cn(
                  "flex h-9 w-full cursor-default items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-accent",
                  active?.exe === s.exe && "text-[var(--ch-music)]",
                )}
              >
                <span className="truncate">{s.name}</span>
                {s.playing && <span className="font-mono text-3xs text-muted-foreground uppercase">spielt</span>}
              </button>
            ))}
            {error && <p className="px-2.5 py-2 text-xs text-error-foreground">{error}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
