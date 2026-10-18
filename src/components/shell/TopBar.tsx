import { Search } from "lucide-react";
import { Kbd } from "~/components/ui/misc";
import { useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { WindowControls } from "./WindowControls";

function CableStatus() {
  const info = useStore((s) => s.info);
  const meters = useStore((s) => s.meters);
  const hasErrors = (meters?.errors.length ?? 0) > 0;

  const status = !info
    ? { label: "Engine aus", dot: "bg-muted-foreground/40" }
    : !info.cable
      ? { label: "Kein Kabel", dot: "bg-warning" }
      : hasErrors
        ? { label: "Gerätefehler", dot: "bg-error" }
        : { label: "Kabel aktiv", dot: "bg-success" };

  return (
    <div
      className="flex h-7 items-center gap-2 rounded-control border border-border px-2.5 text-xs text-muted-foreground"
      title={info?.cable?.deviceName ?? "Virtuelles Kabel"}
    >
      <span className="relative flex size-2">
        {info?.cable && !hasErrors && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", status.dot)} />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", status.dot)} />
      </span>
      {status.label}
    </div>
  );
}

export function TopBar({ title }: { title: string }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-border px-4"
    >
      <h1 data-tauri-drag-region className="text-sm font-medium">
        {title}
      </h1>
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          type="button"
          className="flex h-7 w-full max-w-sm cursor-default items-center gap-2 rounded-control border border-border bg-card px-2.5 text-xs text-muted-foreground hover:border-input"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Sounds und Titel suchen …</span>
          <Kbd>Strg K</Kbd>
        </button>
      </div>
      <CableStatus />
      <WindowControls />
    </header>
  );
}
