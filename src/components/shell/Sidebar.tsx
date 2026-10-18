import { Download, LayoutGrid, Moon, Music, Plus, Settings, SlidersHorizontal, Star, Sun, Wand2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useStore } from "~/lib/store";
import { cn, gainToDb } from "~/lib/utils";

export type View = "soundboard" | "music" | "mixer" | "effects" | "downloads" | "settings";

export const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "soundboard", label: "Soundboard", icon: <LayoutGrid /> },
  { id: "music", label: "Musik", icon: <Music /> },
  { id: "mixer", label: "Mischpult", icon: <SlidersHorizontal /> },
  { id: "effects", label: "Effekte", icon: <Wand2 /> },
  { id: "downloads", label: "Downloads", icon: <Download /> },
];

export const SETTINGS = { id: "settings" as const, label: "Einstellungen", icon: <Settings /> };

/** Wortmarke: ein Ring, der wie eine Schallwelle aufgeht. */
function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <defs>
          <linearGradient id="ode-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.8 0.17 70)" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="10" fill="url(#ode-logo)" />
        <circle cx="16" cy="16" r="7" fill="none" stroke="oklch(18% 0.02 50)" strokeWidth="3" />
        <path d="M24.5 9.5a11 11 0 0 1 0 13" fill="none" stroke="oklch(18% 0.02 50)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </svg>
      <div className="leading-none">
        <div className="font-display text-xl font-bold tracking-tight">ode</div>
        <div className="mt-0.5 font-mono text-3xs tracking-[0.18em] text-muted-foreground uppercase">
          Soundboard
        </div>
      </div>
    </div>
  );
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
        "group relative flex h-10 w-full cursor-default items-center gap-3 rounded-xl px-1.5 text-left text-sm font-medium transition-all duration-200",
        active
          ? "bg-panel-raised text-foreground shadow-[0_1px_0_var(--hairline),0_6px_16px_-10px_oklch(0%_0_0/45%)]"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-lg transition-all duration-200 [&_svg]:size-4",
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="group flex h-7 items-center justify-between pr-1 pl-2.5">
        <span className="font-mono text-3xs tracking-[0.16em] text-muted-foreground/80 uppercase">{title}</span>
        <button
          type="button"
          title={`${title} hinzufügen`}
          className="flex size-5 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-3.5"
        >
          <Plus />
        </button>
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function ListItem({ swatch, label, count }: { swatch: ReactNode; label: string; count: number }) {
  return (
    <button
      type="button"
      className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      {swatch}
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-3xs tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/** Kleine Live-Anzeige: Mikrofonpegel als Balkenreihe und die aktuelle Latenz. */
function LiveCard() {
  const meters = useStore((s) => s.meters);
  const info = useStore((s) => s.info);
  const history = useRef<number[]>(Array(18).fill(0));

  const peak = meters?.channels.find((c) => c.id === "mic")?.peak ?? 0;
  const level = info ? (gainToDb(peak, -48) + 48) / 48 : 0;
  history.current = [...history.current.slice(1), level];

  return (
    <div className="rounded-xl bg-sidebar-accent p-3">
      <div className="flex items-center justify-between">
        <span className={cn("text-2xs font-semibold", info ? "text-primary" : "text-muted-foreground")}>
          {info ? "Live" : "Engine aus"}
        </span>
        <span className="font-mono text-3xs text-muted-foreground tabular-nums">
          {info && meters ? `${meters.latencyMs.toFixed(0)} ms` : "—"}
        </span>
      </div>
      <div className="mt-2.5 flex h-7 items-end gap-[3px]">
        {history.current.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-[2px] bg-primary transition-[height] duration-75"
            style={{ height: `${Math.max(8, v * 100)}%`, opacity: info ? 0.35 + (i / 18) * 0.65 : 0.15 }}
          />
        ))}
      </div>
    </div>
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

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-3">
        <div className="space-y-0.5">
          {VIEWS.map((v) => (
            <NavItem key={v.id} icon={v.icon} label={v.label} active={view === v.id} onClick={() => onView(v.id)} />
          ))}
        </div>

        <Section title="Kategorien">
          <ListItem swatch={<Star className="size-3.5 text-primary" />} label="Favoriten" count={0} />
        </Section>

        <Section title="Playlists">
          <ListItem
            swatch={
              <span className="size-5 rounded-md bg-[conic-gradient(from_200deg,var(--ch-music),var(--ch-soundboard),var(--primary),var(--ch-music))]" />
            }
            label="Alle Titel"
            count={0}
          />
        </Section>
      </nav>

      <div className="space-y-2 p-2">
        <LiveCard />
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
