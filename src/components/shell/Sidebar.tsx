import { Broadcast, DownloadSimple, GearSix, Moon, Plus, Sliders, Star, Sun, VinylRecord, Waveform, Waves } from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";
import { music, useMusic } from "~/lib/music";
import { cn } from "~/lib/utils";
import { OutputVolume } from "./OutputVolume";

export type View = "soundboard" | "music" | "live" | "mixer" | "effects" | "downloads" | "settings";

export const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "soundboard", label: "Soundboard", icon: <Waveform /> },
  { id: "music", label: "Musik", icon: <VinylRecord /> },
  { id: "live", label: "Live", icon: <Broadcast /> },
  { id: "mixer", label: "Mischpult", icon: <Sliders /> },
  { id: "effects", label: "Effekte", icon: <Waves /> },
  { id: "downloads", label: "Downloads", icon: <DownloadSimple /> },
];

export const SETTINGS = {
  id: "settings" as const,
  label: "Einstellungen",
  icon: <GearSix />,
};

/** Wortmarke: nur der Name in der Überschriftenschrift. */
function Logo() {
  return <div className="font-display text-[30px] leading-none font-semibold tracking-tight">ode</div>;
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full cursor-default items-center gap-3 rounded-xl px-3 text-left text-[14px] font-semibold transition-colors duration-150 [&_svg]:size-[18px] [&_svg]:shrink-0",
        active
          ? "bg-panel-raised text-foreground shadow-[0_1px_0_var(--hairline),0_6px_16px_-10px_oklch(0%_0_0/45%)] [&_svg]:text-primary"
          : "text-foreground/70 hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <div>
      <div className="group flex h-6 items-center justify-between pr-1 pl-2.5">
        <span className="font-mono text-3xs tracking-[0.16em] text-muted-foreground/80 uppercase">{title}</span>
        {onAdd && (
          <button
            type="button"
            title={`${title} hinzufügen`}
            onClick={onAdd}
            className="flex size-5 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-3.5"
          >
            <Plus />
          </button>
        )}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function ListItem({
  swatch,
  label,
  count,
  active,
  onClick,
}: {
  swatch: ReactNode;
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {swatch}
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-3xs tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/** Kleines Cover: jede Playlist bekommt einen eigenen Farbverlauf aus ihrer ID. */
function Cover({ seed }: { seed: number | null }) {
  const from = seed === null ? 200 : (seed * 67) % 360;
  return (
    <span
      className="size-5 shrink-0 rounded-[5px]"
      style={{
        background:
          seed === null
            ? "conic-gradient(from 200deg, var(--ch-music), var(--ch-soundboard), var(--primary), var(--ch-music))"
            : `linear-gradient(135deg, oklch(0.72 0.14 ${from}), oklch(0.55 0.16 ${(from + 50) % 360}))`,
      }}
    />
  );
}

function Playlists({ view, onView }: { view: View; onView: (view: View) => void }) {
  const playlists = useMusic((s) => s.playlists);
  const total = useMusic((s) => s.tracks.length);
  const selected = useMusic((s) => s.selectedPlaylist);

  useEffect(() => {
    void music.init();
  }, []);

  const open = (id: number | null) => {
    music.selectPlaylist(id);
    onView("music");
  };

  const create = async () => {
    await music.createPlaylist("Neue Playlist");
    onView("music");
  };

  return (
    <Section title="Playlists" onAdd={() => void create()}>
      <ListItem
        swatch={<Cover seed={null} />}
        label="Alle Titel"
        count={total}
        active={view === "music" && selected === null}
        onClick={() => open(null)}
      />
      {playlists.map((p) => (
        <ListItem
          key={p.id}
          swatch={<Cover seed={p.id} />}
          label={p.name}
          count={p.trackIds.length}
          active={view === "music" && selected === p.id}
          onClick={() => open(p.id)}
        />
      ))}
    </Section>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <div className="relative grid grid-cols-2 rounded-lg bg-sidebar-accent p-0.5">
      <span
        className={cn(
          "absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-panel-raised shadow-sm transition-transform duration-300 ease-drawer",
          dark && "translate-x-full",
        )}
      />
      {[
        { on: !dark, icon: <Sun />, label: "Heller Modus" },
        { on: dark, icon: <Moon />, label: "Dunkler Modus" },
      ].map(({ on, icon, label }) => (
        <button
          key={label}
          type="button"
          title={label}
          onClick={() => !on && onToggle()}
          className={cn(
            "relative flex h-6 cursor-default items-center justify-center transition-colors [&_svg]:size-3.5",
            on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {icon}
        </button>
      ))}
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
    <aside className="panel m-2 mr-0 flex w-[var(--sidebar-width)] shrink-0 flex-col rounded-2xl bg-sidebar backdrop-blur-xl">
      <div data-tauri-drag-region className="px-4 pt-4 pb-5">
        <Logo />
      </div>

      <nav className="min-h-0 shrink space-y-3 overflow-y-auto px-2 pb-3">
        <div className="space-y-0.5">
          {VIEWS.map((v) => (
            <NavItem key={v.id} icon={v.icon} label={v.label} active={view === v.id} onClick={() => onView(v.id)} />
          ))}
        </div>

        <Section title="Kategorien">
          <ListItem swatch={<Star className="size-3.5 text-primary" />} label="Favoriten" count={0} />
        </Section>

        <Playlists view={view} onView={onView} />
      </nav>

      <div className="flex min-h-56 flex-1 flex-col gap-2 p-2">
        <OutputVolume />
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <NavItem
              icon={SETTINGS.icon}
              label={SETTINGS.label}
              active={view === SETTINGS.id}
              onClick={() => onView(SETTINGS.id)}
            />
          </div>
          <div className="w-[4.5rem] shrink-0">
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>
        </div>
      </div>
    </aside>
  );
}
