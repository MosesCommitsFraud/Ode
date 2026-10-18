import {
  AudioLines,
  Download,
  LayoutGrid,
  ListMusic,
  Moon,
  Music,
  Plus,
  SlidersHorizontal,
  Star,
  Sun,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type View = "soundboard" | "music" | "mixer" | "effects" | "downloads";

export const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "soundboard", label: "Soundboard", icon: <LayoutGrid /> },
  { id: "music", label: "Musik", icon: <Music /> },
  { id: "mixer", label: "Mischpult", icon: <SlidersHorizontal /> },
  { id: "effects", label: "Effekte", icon: <Wand2 /> },
  { id: "downloads", label: "Downloads", icon: <Download /> },
];

function Item({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full cursor-default items-center gap-2 rounded-control px-2.5 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <span className={cn(active ? "text-foreground" : "text-muted-foreground/80")}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="font-mono text-3xs text-muted-foreground tabular-nums">{count}</span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="group flex h-7 items-center justify-between px-2.5">
        <span className="text-2xs font-medium tracking-wide text-muted-foreground/80 uppercase">{title}</span>
        <button
          type="button"
          title={`${title} hinzufügen`}
          className="flex size-5 cursor-default items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent [&_svg]:size-3.5"
        >
          <Plus />
        </button>
      </div>
      {children}
    </div>
  );
}

export function Sidebar({
  view,
  onView,
  dark,
  onToggleTheme,
}: {
  view: View;
  onView: (view: View) => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-sidebar">
      <div data-tauri-drag-region className="flex h-[var(--topbar-height)] items-center gap-2 px-4">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <AudioLines className="size-3.5" />
        </div>
        <span data-tauri-drag-region className="font-semibold tracking-tight">
          Ode
        </span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <div className="space-y-0.5">
          {VIEWS.map((v) => (
            <Item key={v.id} icon={v.icon} label={v.label} active={view === v.id} onClick={() => onView(v.id)} />
          ))}
        </div>

        <Section title="Kategorien">
          <Item icon={<Star />} label="Favoriten" count={0} />
        </Section>

        <Section title="Playlists">
          <Item icon={<ListMusic />} label="Alle Titel" count={0} />
        </Section>
      </nav>

      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <span className="font-mono text-3xs text-muted-foreground">v0.1.0</span>
        <button
          type="button"
          onClick={onToggleTheme}
          title={dark ? "Heller Modus" : "Dunkler Modus"}
          className="flex size-7 cursor-default items-center justify-center rounded-control text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4"
        >
          {dark ? <Sun /> : <Moon />}
        </button>
      </div>
    </aside>
  );
}
