import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { Toggle } from "~/components/ui/hardware";
import { Pill, PillGroup } from "~/components/ui/pills";
import { parseNumber } from "~/components/ui/knob";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/*
 * Bausteine der Effekt-, Stimm- und Bus-Seiten: oben eine Leiste mit allen
 * Geräten zum Durchschalten (wie die Preset-Leiste), darunter das gewählte
 * Gerät als Seite mit Erklärung, Live-Werten und Einstellungen in Zeilen.
 * Alles aus echten Bedienelementen, keine Zeichnungen.
 */

const accentStyle = (accent?: string) => (accent ? ({ "--ch-mic": accent, "--key": accent } as CSSProperties) : ({ "--key": "var(--ch-mic)" } as CSSProperties));

export type DeviceKey = { id: string; title: string; icon: ReactNode; enabled: boolean; accent?: string };

/**
 * Alle Geräte als Pillen wie die Seitenwahl im Mischpult: die gewählte hebt
 * sich hell heraus (die Markierung gleitet mit), das Symbol trägt die
 * Gerätefarbe, solange das Gerät an ist. Gruppen trennt ein feiner Strich.
 */
export function DeviceBar({ groups, value, onChange, className }: { groups: DeviceKey[][]; value: string; onChange: (id: string) => void; className?: string }) {
  const ids = groups.flat().map((d) => d.id);
  return (
    <div
      role="tablist"
      className={cn("min-w-0", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        onChange(ids[(ids.indexOf(value) + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]);
      }}
    >
      <PillGroup className="w-fit max-w-full">
        {groups.map((group, g) => [
          g > 0 && <span key={`s${g}`} aria-hidden className="mx-1 h-4 w-px shrink-0 bg-hairline" />,
          ...group.map((d) => (
            <Pill
              key={d.id}
              role="tab"
              aria-selected={d.id === value}
              active={d.id === value}
              onClick={() => onChange(d.id)}
              style={accentStyle(d.accent)}
              className="min-w-0 shrink"
            >
              <span className={cn("transition-colors duration-300 [&_svg]:size-3.5", d.enabled ? "text-[var(--key)]" : "text-muted-foreground/60")}>{d.icon}</span>
              <span className="truncate">{d.title}</span>
            </Pill>
          )),
        ])}
      </PillGroup>
    </div>
  );
}

/**
 * Ein Gerät als Seite: Symbol, Name und ein Satz, was es tut; rechts
 * Zurücksetzen und der Schalter. Darunter optional Live-Werte (`live`) und
 * die Einstellungen als Zeilen, bei Bedarf in zwei Spalten.
 */
export function DevicePage({
  icon,
  title,
  about,
  enabled,
  onToggle,
  onReset,
  live,
  graph,
  columns = 1,
  accent,
  children,
}: {
  icon: ReactNode;
  title: string;
  about: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onReset?: () => void;
  live?: ReactNode;
  /** Diagramm zwischen Live-Werten und Einstellungen; nimmt den freien Platz. */
  graph?: ReactNode;
  columns?: 1 | 2;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <section style={accentStyle(accent)} className="panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <header className="flex shrink-0 items-start gap-4 px-6 pt-5 pb-4">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-[12px] transition-colors duration-300 [&_svg]:size-6",
            enabled ? "bg-[var(--key)] text-white" : "bg-[var(--meter-track)] text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl leading-tight font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{about}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          {onReset && (
            <button
              type="button"
              title={t("devices.reset")}
              onClick={onReset}
              className="flex h-8 cursor-default items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            >
              <ArrowCounterClockwise /> {t("devices.reset")}
            </button>
          )}
          <label className="flex cursor-default items-center gap-2 text-sm font-medium">
            <span className={cn("transition-colors", enabled ? "text-foreground" : "text-muted-foreground")}>{enabled ? t("common.on") : t("common.off")}</span>
            <Toggle label={title} on={enabled} onChange={onToggle} />
          </label>
        </div>
      </header>
      {live && (
        <div className={cn("mx-6 mb-2 flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 rounded-[12px] bg-[var(--meter-track)] px-5 py-3 transition-opacity duration-300", !enabled && "opacity-50")}>
          {live}
        </div>
      )}
      {graph && (
        <div className={cn("well relative mx-6 mb-1 min-h-[140px] flex-1 overflow-hidden rounded-[12px] transition-opacity duration-300", !enabled && "opacity-50")}>
          {graph}
        </div>
      )}
      <div
        className={cn(
          "grid min-h-0 content-start gap-x-12 px-6 pb-3 transition-opacity duration-300",
          graph ? "shrink-0" : "flex-1",
          columns === 2 ? "grid-cols-2" : "grid-cols-1",
          !enabled && "opacity-60",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Eine Einstellung: links Name und kurze Erklärung, rechts das Bedienelement. */
export function ParamRow({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    // Name links, Regler rechts; in schmalen Spalten bekommt der Name weniger Breite.
    <div className={cn("@container min-w-0 border-b border-hairline py-3 last:border-b-0", wide && "col-span-full")}>
      <div className="grid min-w-0 grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-x-4 @[38rem]:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @[38rem]:gap-x-6">
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          {hint && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

/** Wert neben einem Regler: anklicken zum Eintippen, Enter übernimmt. */
function ValueField({ text, onCommit, label }: { text: string; onCommit: (text: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <input
      autoFocus
      aria-label={label}
      defaultValue={text}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        setEditing(false);
        onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-8 w-24 shrink-0 rounded-lg bg-panel-raised px-2 text-right font-mono text-sm tabular-nums shadow-[0_0_0_1.5px_var(--ch-mic)] outline-none"
    />
  ) : (
    <button
      type="button"
      title={t("common.typeValue")}
      onClick={() => setEditing(true)}
      className="well h-8 w-24 shrink-0 cursor-text truncate rounded-lg px-2 text-right font-mono text-sm tabular-nums transition-colors hover:text-[var(--ch-mic)]"
    >
      {text}
    </button>
  );
}

/**
 * Waagrechter Schieberegler mit Wert daneben. Klicken springt, Ziehen
 * stellt ein (Shift fein), Mausrad und Pfeiltasten in Schritten, Doppelklick
 * setzt zurück; der Wert lässt sich eintippen. `bipolar` füllt von der Mitte,
 * `marks` beschriftet Stellen unter der Bahn.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  reset,
  bipolar,
  marks,
  parse,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  reset?: number;
  bipolar?: boolean;
  marks?: [number, string][];
  parse?: (text: string) => number | null;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const fine = useRef<{ x: number; value: number } | null>(null);
  const range = max - min;
  const pos = range > 0 ? Math.min(1, Math.max(0, (value - min) / range)) : 0;
  const origin = bipolar ? 0.5 : 0;
  const set = (v: number) => {
    const next = Number((Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min))).toFixed(6));
    if (next !== value) onChange(next);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    // Mit Shift fein: relativ zur Startstelle, zehnmal langsamer.
    if (e.shiftKey && fine.current) {
      set(fine.current.value + ((e.clientX - fine.current.x) / r.width) * range * 0.1);
      return;
    }
    set(min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * range);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const big = Math.max(step, Math.round(range / step / 10) * step);
    const delta: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
    if (e.key in delta) set(value + delta[e.key]);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else return;
    e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    const steps = Math.max(1, Math.round(range / step / (e.shiftKey ? 200 : 50)));
    set(value + (e.deltaY < 0 ? 1 : -1) * steps * step);
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-3", disabled && "pointer-events-none opacity-45")}>
      <div className="min-w-0 flex-1">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format(value)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            fine.current = { x: e.clientX, value };
            if (!e.shiftKey) fromPointer(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
          onPointerUp={() => {
            fine.current = null;
          }}
          onDoubleClick={() => reset !== undefined && set(reset)}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          className="group relative h-7 cursor-default touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="well absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full" />
          {bipolar && <div className="absolute top-1/2 left-1/2 h-3.5 w-px -translate-y-1/2 bg-muted-foreground/40" />}
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--ch-mic)]"
            style={{ left: `${Math.min(origin, pos) * 100}%`, width: `${Math.abs(pos - origin) * 100}%` }}
          />
          <div
            className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_oklch(0%_0_0/35%),0_0_0_1px_oklch(0%_0_0/10%)] transition-transform duration-150 group-active:scale-110"
            style={{ left: `${pos * 100}%` }}
          />
        </div>
        {marks && (
          <div className="relative mx-[9px] h-4">
            {marks.map(([v, text]) => (
              <button
                key={v}
                type="button"
                onClick={() => set(v)}
                className="absolute top-0.5 -translate-x-1/2 cursor-default font-mono text-[10px] whitespace-nowrap text-muted-foreground tabular-nums hover:text-foreground"
                style={{ left: `${((v - min) / range) * 100}%` }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
      </div>
      <ValueField label={label} text={format(value)} onCommit={(text) => {
        const next = parse ? parse(text) : parseNumber(text, format(value));
        if (next !== null && Number.isFinite(next)) set(next);
      }} />
    </div>
  );
}

/** Schnellwahl unter oder neben einer Einstellung: kleine Tasten, die Werte setzen. */
export function QuickPicks<T>({ options, onPick, isActive }: { options: { label: string; value: T }[]; onPick: (value: T) => void; isActive?: (value: T) => boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = isActive?.(o.value);
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onPick(o.value)}
            className={cn(
              "h-7 cursor-default rounded-full px-3 text-xs transition-colors",
              active ? "bg-[var(--ch-mic)] font-medium text-white" : "bg-[var(--meter-track)] text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pegel als waagrechter Balken mit Beschriftung links und Wert rechts;
 * optional eine Marke (z. B. die Schwelle) und eine Skala. `from` legt fest,
 * wo die Füllung beginnt (0 links, 0,5 Mitte für ±-Werte).
 */
export function Meter({
  label,
  value,
  text,
  marker,
  from = 0,
  scale,
  tone = "accent",
  className,
}: {
  label: string;
  /** Füllstand 0–1. */
  value: number;
  /** Wert rechts daneben. */
  text?: string;
  marker?: number;
  from?: number;
  scale?: [number, string][];
  tone?: "accent" | "success" | "warning";
  className?: string;
}) {
  const v = Math.min(1, Math.max(0, value));
  const color = tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "var(--ch-mic)";
  return (
    <div className={cn("flex min-w-[220px] flex-1 items-center gap-3", className)}>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_2px_oklch(0%_0_0/18%)]">
          <div
            className="absolute inset-y-0 rounded-full transition-[left,width] duration-75"
            style={{ left: `${Math.min(from, v) * 100}%`, width: `${Math.abs(v - from) * 100}%`, background: color }}
          />
          {marker !== undefined && <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${marker * 100}%` }} />}
        </div>
        {scale && (
          <div className="relative h-3.5">
            {scale.map(([p, s]) => (
              <span key={p} className="absolute top-0.5 -translate-x-1/2 font-mono text-[9px] text-muted-foreground tabular-nums" style={{ left: `${p * 100}%` }}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      {text !== undefined && <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{text}</span>}
    </div>
  );
}

/** Lampe mit Beschriftung: leuchtet, solange zutrifft, was daneben steht. */
export function Lamp({ on, label, tone = "success" }: { on: boolean; label: string; tone?: "success" | "accent" }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2.5 rounded-full transition-colors duration-150",
          on ? (tone === "success" ? "bg-[var(--success)]" : "bg-[var(--ch-mic)]") : "bg-[var(--led-off)] shadow-[inset_0_1px_1px_oklch(0%_0_0/25%)]",
        )}
      />
      <span className={cn("transition-colors", on && "text-foreground")}>{label}</span>
    </span>
  );
}

/** Große Live-Anzeige eines Werts, z. B. die gesungene Note. */
export function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-display text-2xl leading-none font-semibold tabular-nums">{value}</span>
      {sub && <span className="font-mono text-xs text-muted-foreground tabular-nums">{sub}</span>}
    </div>
  );
}

/** Gewähltes Gerät je Seite, im Browser gemerkt. */
export function useSelected<T extends string>(key: string, ids: readonly T[], fallback: T) {
  const [stored, setStored] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const value = (ids.find((i) => i === stored) ?? fallback) as T;
  const select = (id: string) => {
    setStored(id);
    try {
      localStorage.setItem(key, id);
    } catch {
      // Nur Komfort.
    }
  };
  return [value, select] as const;
}

/**
 * Weicher Wechsel zwischen Seiten: die alte blendet aus, während die neue
 * schon darüber einblendet; nie ein leerer Moment. Die Richtung folgt der
 * Reihenfolge in `order`.
 */
export function Crossfade({ id, order, children, className, axis = "x" }: { id: string; order: string[]; children: ReactNode; className?: string; axis?: "x" | "y" }) {
  const [shown, setShown] = useState(id);
  const last = useRef<ReactNode>(children);
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode; dir: number } | null>(null);
  if (shown !== id) {
    setLeaving({ id: shown, node: last.current, dir: order.indexOf(id) > order.indexOf(shown) ? 1 : -1 });
    setShown(id);
  }
  useEffect(() => {
    last.current = children;
  });
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 320);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const shift = { "--dir": leaving?.dir ?? 1, "--sx": axis === "x" ? "18px" : "0px", "--sy": axis === "y" ? "14px" : "0px" } as CSSProperties;
  return (
    <div className={cn("relative grid min-h-0 min-w-0 flex-1", className)} style={shift}>
      {leaving && (
        <div key={leaving.id} aria-hidden className="pointer-events-none col-start-1 row-start-1 flex min-h-0 min-w-0 animate-[page-out_260ms_ease-in_forwards]">
          {leaving.node}
        </div>
      )}
      <div key={id} className={cn("col-start-1 row-start-1 flex min-h-0 min-w-0", leaving && "animate-[page-in_340ms_var(--ease-drawer)]")}>
        {children}
      </div>
    </div>
  );
}
