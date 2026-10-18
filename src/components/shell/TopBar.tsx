import { Search } from "./Search";
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
        <Search />
      </div>
      <WindowControls />
    </header>
  );
}
