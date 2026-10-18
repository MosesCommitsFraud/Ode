import { Search } from "lucide-react";
import { Kbd } from "~/components/ui/misc";
import { useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

function CableStatus() {
  const info = useStore((s) => s.info);
  const meters = useStore((s) => s.meters);
  const hasErrors = (meters?.errors.length ?? 0) > 0;

  const status = !info
    ? { label: "Engine aus", dot: "bg-muted-foreground/40", live: false }
    : !info.cable
      ? { label: "Kein Kabel", dot: "bg-warning", live: false }
      : hasErrors
        ? { label: "Gerätefehler", dot: "bg-error", live: false }
        : { label: "Kabel aktiv", dot: "bg-success", live: true };

  return (
    <div
      className="panel flex h-9 items-center gap-2 rounded-full pr-3.5 pl-3 text-xs font-medium"
      title={info?.cable?.deviceName ?? "Virtuelles Kabel"}
    >
      <span className="relative flex size-2">
        {status.live && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", status.dot)} />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", status.dot)} />
      </span>
      {status.label}
    </div>
  );
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex h-[var(--topbar-height)] shrink-0 items-center gap-4 px-6 pt-2">
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-none font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-1 justify-end">
        <button
          type="button"
          className="panel flex h-9 w-full max-w-xs cursor-default items-center gap-2 rounded-full pr-1.5 pl-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Sounds und Titel suchen …</span>
          <Kbd className="rounded-full px-2">Strg K</Kbd>
        </button>
      </div>
      <CableStatus />
    </header>
  );
}
