import { Search } from "lucide-react";
import { Kbd } from "~/components/ui/misc";
import { WindowControls } from "./WindowControls";

export function TopBar({ title }: { title: string }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--topbar-height)] shrink-0 items-center gap-3 pt-2 pr-3 pl-6"
    >
      <div data-tauri-drag-region className="min-w-0">
        <h1 data-tauri-drag-region className="font-display text-2xl leading-none font-semibold tracking-tight">{title}</h1>
      </div>
      <div data-tauri-drag-region className="flex flex-1 justify-end">
        <button
          type="button"
          className="panel flex h-9 w-full max-w-xs cursor-default items-center gap-2 rounded-full pr-1.5 pl-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Sounds und Titel suchen …</span>
          <Kbd className="rounded-full px-2">Strg K</Kbd>
        </button>
      </div>
      <WindowControls />
    </header>
  );
}
