import { Search } from "./Search";
import { WindowControls } from "./WindowControls";

/** Titel, Suche und Fensterknöpfe stehen auf derselben Linie wie der Schriftzug „ode“ in der Sidebar. */
export function TopBar({ title }: { title: string }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--topbar-height)] shrink-0 items-start gap-3 pt-[22px] pr-3 pl-6"
    >
      <div data-tauri-drag-region className="flex h-9 min-w-0 items-center">
        <h1 data-tauri-drag-region className="font-display text-[30px] leading-none font-semibold tracking-tight">{title}</h1>
      </div>
      <div data-tauri-drag-region className="flex flex-1 justify-end">
        <Search />
      </div>
      <WindowControls />
    </header>
  );
}
