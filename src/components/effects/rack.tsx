import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Toggle } from "~/components/ui/hardware";
import { HelpIcon } from "./HelpDrawer";
import { t } from "~/lib/i18n";
import { cn, formatDb } from "~/lib/utils";

/* Bausteine der Effekt-Seiten: Module als Karten mit Anzeige und Reglern. */

/**
 * Ein Effekt als Karte: Name mit Schalter rechts, eine Anzeige, in der sich
 * oft direkt ziehen lässt, und die Regler. Die Karte passt sich ihrem Platz
 * an: groß Anzeige und Regler, breit und flach Regler neben der Anzeige,
 * klein nur die Regler.
 */
export function Module({
  title,
  enabled,
  onToggle,
  display,
  className,
  children,
  accent,
  help,
  keys,
  meter,
  highlight,
  stacked,
  name,
}: {
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  /** Anzeige; fällt weg, wenn die Karte klein ist. */
  display?: ReactNode;
  /** Platz im Raster, z. B. `row-span-2`. */
  className?: string;
  /** Regler. */
  children?: ReactNode;
  /** Farbe für Anzeige und Regler, z. B. die Kanalfarbe. */
  accent?: string;
  /** Werkzeug für die Erklärung hinter dem „?“ am Titel (siehe i18n/help.ts). */
  help?: string;
  /** Wahltasten, z. B. Modus oder Tonart. */
  keys?: ReactNode;
  /** Schmales Meter neben den Reglern, z. B. die Absenkung. */
  meter?: ReactNode;
  /** Kurz hervorheben, z. B. wenn es in der Liste angeklickt wurde. */
  highlight?: boolean;
  /** Regler immer unter der Anzeige, z. B. wenn die Anzeige ihre Breite braucht. */
  stacked?: boolean;
  /** Name für weiche Übergänge, wenn Karten kommen und gehen. */
  name?: string;
}) {
  // Ohne eigene Farbe bleibt --ch-mic geerbt; sich selbst zuweisen wäre ungültig.
  const style: Record<string, string> = accent ? { "--ch-mic": accent, "--ch": accent } : { "--ch": "var(--ch-mic)" };
  if (name) style.viewTransitionName = name;
  return (
    <section
      style={style}
      className={cn(
        "panel flex min-h-0 min-w-0 flex-col gap-2.5 rounded-2xl p-3.5 transition-shadow duration-500",
        highlight && "shadow-[inset_0_0_0_2px_var(--ch-mic)]",
        className,
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <h3 className={cn("min-w-0 truncate font-display text-lg font-semibold tracking-tight transition-colors duration-300", !enabled && "text-muted-foreground")}>
          {title}
        </h3>
        {help && <HelpIcon topic={help} />}
        <div className="flex-1" />
        <Toggle label={title} on={enabled} onChange={onToggle} />
      </div>
      <div className={cn("device-body min-h-0 flex-1 transition-[opacity,filter] duration-300", !enabled && "opacity-50 grayscale")}>
        <div className={cn("device-layout flex size-full flex-col justify-center gap-3", stacked && "device-stacked")}>
          {display && (
            // Mulde: Rundung der Karte (16) minus Innenabstand, damit beide konzentrisch wirken.
            <div className="device-display well relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[10px]">{display}</div>
          )}
          {(keys || children || meter) && (
            <div className="device-side flex min-h-0 min-w-0 shrink-0 items-stretch justify-center gap-3">
              {(keys || children) && (
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
                  {keys && <div className="flex flex-col gap-2">{keys}</div>}
                  {children && <div className="flex flex-wrap content-center items-start justify-center gap-x-1 gap-y-2">{children}</div>}
                </div>
              )}
              {meter}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Absenkung als schmales senkrechtes Meter mit dB-Skala: wächst von oben,
 * je stärker das Gerät gerade eingreift.
 */
export function ReductionMeter({ db, max, label }: { db: number; max: number; label: string }) {
  const ticks = [0, -Math.round(max / 2), -max];
  return (
    <div title={label} aria-label={label} className="flex shrink-0 flex-col items-center gap-1 py-1">
      <div className="flex min-h-16 flex-1 gap-1">
        <div className="relative w-6 font-mono text-[9px] text-muted-foreground tabular-nums">
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${(-v / max) * 100}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div className="relative w-2 overflow-hidden rounded-full bg-[var(--meter-track)]">
          <div
            className="absolute inset-x-0 top-0 rounded-full bg-[var(--ch-mic)] transition-[height] duration-100"
            style={{ height: `${Math.min(1, Math.max(0, -db / max)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Lampe, die leuchtet, solange etwas zutrifft (z. B. Sprache erkannt). */
export function Lamp({ on, label }: { on: boolean; label: string }) {
  return (
    <span title={label} className="flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <span className={cn("size-2 rounded-full transition-colors duration-150", on ? "bg-[var(--success)]" : "bg-[var(--led-off)] shadow-[inset_0_1px_1px_oklch(0%_0_0/25%)]")} />
      {label}
    </span>
  );
}

/** Früher gestapelte Regler; jetzt stehen alle in einer Reihe. */
export function Stack({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Senkrechter Strich zwischen Reglergruppen. */
export function Divider() {
  return <div aria-hidden className="w-px self-stretch bg-hairline" />;
}

/**
 * Zustandswechsel mit weichem Übergang: Karten, die kommen oder gehen,
 * blenden ein und aus, die übrigen gleiten an ihren neuen Platz.
 */
export function smooth(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  // Nur die Karten bewegen sich; die übrige Seite wechselt ohne Überblendung.
  const root = document.documentElement;
  root.classList.add("vt-devices");
  const transition = doc.startViewTransition(() => flushSync(update)) as { finished?: Promise<void> };
  void transition.finished?.finally(() => root.classList.remove("vt-devices"));
}

export type ChainDevice = { id: string; title: string; icon: ReactNode; enabled: boolean; onToggle: (on: boolean) => void; accent?: string };

/**
 * Die Kette als Signalweg: eine Linie vom Eingang zum Ausgang, jedes Gerät
 * ein Knoten darauf. Aktive Knoten tragen ihre Farbe; ein Klick auf die Zeile
 * schaltet das Gerät ein oder hebt seine Karte hervor.
 */
export function ChainList({
  start,
  end,
  groups,
  onFocus,
  className,
}: {
  start: { label: string; icon: ReactNode };
  end: { label: string; icon: ReactNode };
  groups: { title: string; devices: ChainDevice[] }[];
  onFocus: (id: string) => void;
  className?: string;
}) {
  const endpoint = (p: { label: string; icon: ReactNode }) => (
    <div className="relative flex h-8 items-center gap-2.5 pl-1.5 text-xs text-muted-foreground">
      <span className="flex size-7 items-center justify-center rounded-full bg-panel text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--hairline)] [&_svg]:size-3.5">
        {p.icon}
      </span>
      {p.label}
    </div>
  );
  return (
    <nav className={cn("panel relative flex w-56 shrink-0 flex-col self-start rounded-2xl px-2 py-2.5", className)}>
      {/* Die Leitung hinter den Knoten. */}
      <span aria-hidden className="absolute top-6 bottom-6 left-[27px] w-0.5 rounded-full bg-hairline" />
      {endpoint(start)}
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col">
          <div className="relative py-1.5 pl-12 font-mono text-3xs tracking-[0.16em] text-muted-foreground uppercase">{g.title}</div>
          {g.devices.map((d) => (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => (d.enabled ? onFocus(d.id) : d.onToggle(true))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  d.onToggle(!d.enabled);
                }
              }}
              style={d.accent ? ({ "--ch-mic": d.accent } as React.CSSProperties) : undefined}
              className="group relative flex h-9 cursor-default items-center gap-2.5 rounded-[10px] pr-1.5 pl-1.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-300 group-active:scale-90 [&_svg]:size-3.5",
                  d.enabled
                    ? "bg-[var(--ch-mic)] text-white shadow-[0_2px_6px_-2px_var(--ch-mic)]"
                    : "bg-panel text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--hairline)]",
                )}
              >
                {d.icon}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[13px] transition-colors", d.enabled ? "font-medium text-foreground" : "text-muted-foreground")}>
                {d.title}
              </span>
              <Toggle size="sm" label={d.title} on={d.enabled} onChange={d.onToggle} />
            </div>
          ))}
        </div>
      ))}
      {endpoint(end)}
    </nav>
  );
}

/** Mindestmaße einer Karte, damit Titel und Regler lesbar bleiben. */
const CARD_MIN = { width: 250, height: 150 };
type CardMin = typeof CARD_MIN;

/**
 * Wie viele Spalten und Reihen: die Aufteilung, in der jede Karte am größten
 * ist (gemessen an ihrer kürzeren Seite, bei einem Seitenverhältnis von etwa
 * 1,4), ohne unter das Mindestmaß zu fallen.
 */
function arrange(n: number, width: number, height: number, min: CardMin) {
  let best = { cols: Math.min(n, 2), rows: Math.ceil(n / Math.min(n, 2)), score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (width - (cols - 1) * 12) / cols;
    const h = (height - (rows - 1) * 12) / rows;
    const fits = w >= min.width && h >= min.height;
    const score = (fits ? 10_000 : 0) + Math.min(w / 1.4, h);
    if (score > best.score) best = { cols, rows, score };
  }
  return best;
}

/**
 * Nur die eingeschalteten Geräte, so groß wie der Platz erlaubt. Spalten und
 * Reihen richten sich nach Anzahl und Fläche; übrige Zellen bekommen die
 * Geräte mit der wichtigsten Anzeige (`weight`), die dann doppelt so groß
 * werden. Kleine Karten zeigen nur ihre Regler.
 */
export function ActiveGrid({
  items,
  empty,
  min = CARD_MIN,
}: {
  items: { id: string; weight: number; render: (className: string) => ReactNode }[];
  empty: ReactNode;
  /** Mindestmaße je Karte; Geräte mit vielen Reglern brauchen mehr Höhe. */
  min?: CardMin;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = items.length;
  const { cols, rows } = arrange(Math.max(1, n), size.width, size.height, min);
  const spare = cols * rows - n;
  const big = new Set(
    [...items]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, spare)
      .map((i) => i.id),
  );
  // Mehrere Reihen: doppelt hoch; nur eine Reihe: doppelt breit.
  const span = rows > 1 ? "row-span-2" : "col-span-2";
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1">
      {n === 0 ? (
        <div className="flex flex-1 items-center justify-center">{empty}</div>
      ) : (
        <div
          className="grid min-h-0 min-w-0 flex-1 grid-flow-dense gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {/* Große Karten zuerst, damit das dichte Raster keine Reihe anhängt. */}
          {items.map((i) => (
            <div key={i.id} className={cn("flex min-h-0 min-w-0 [&>*]:flex-1", big.has(i.id) && span)} style={{ order: big.has(i.id) ? -1 : 0 }}>
              {i.render("")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

  const shift = { "--dir": leaving?.dir ?? 1, "--sx": axis === "x" ? "18px" : "0px", "--sy": axis === "y" ? "14px" : "0px" } as React.CSSProperties;
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

/**
 * Fläche in einer Anzeige, in der man zieht: meldet die Zeigerposition als
 * 0–1 (x nach rechts, y nach oben), beim Drücken und beim Ziehen.
 */
export function DragArea({ onDrag, className, title }: { onDrag: (x: number, y: number) => void; className?: string; title?: string }) {
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onDrag(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)));
  };
  return (
    <div
      title={title}
      className={cn("absolute touch-none", className)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e)}
    />
  );
}

/** Beschriftung an einem Griff: was er einstellt und der Wert; weicht am Rand zur anderen Seite aus. */
function HandleTag({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-10 rounded-md bg-panel-raised/95 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground tabular-nums shadow-[0_1px_4px_oklch(0%_0_0/18%)]",
        x > 50 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3",
        y < 18 ? "translate-y-1.5" : "-translate-y-[calc(100%+6px)]",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {children}
    </span>
  );
}

/** Griff in einer Anzeige an Position x/y in Prozent (y von oben), optional mit Beschriftung. */
export function Handle({ x, y, label }: { x: number; y: number; label?: ReactNode }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--ch-mic)] shadow-[0_1px_4px_oklch(0%_0_0/45%)] transition-[left,top] duration-75"
        style={{ left: `${x}%`, top: `${y}%` }}
      />
      {label && (
        <HandleTag x={x} y={y}>
          {label}
        </HandleTag>
      )}
    </>
  );
}

/** Waagrechte Linie zum Ziehen, z. B. eine Schwelle; `y` in Prozent von oben, Beschriftung links an der Linie. */
export function HandleLine({ y, label }: { y: number; label?: ReactNode }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 transition-[top] duration-75" style={{ top: `${y}%` }}>
      <div className="border-t-2 border-dashed border-[var(--ch-mic)]" />
      <span className="absolute right-2 h-4 w-8 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--ch-mic)] shadow-[0_1px_4px_oklch(0%_0_0/45%)]" />
      {label && (
        <span
          className={cn(
            "absolute left-2 rounded-md bg-panel-raised/95 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap tabular-nums shadow-[0_1px_4px_oklch(0%_0_0/18%)]",
            y < 18 ? "top-1.5" : "-top-1.5 -translate-y-full",
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** Beschriftung einer Achse; `at` ist die Position in Prozent. */
export function Tick({ at, axis, children }: { at: number; axis: "x" | "y"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute font-mono text-[9px] leading-none whitespace-nowrap text-muted-foreground tabular-nums",
        axis === "x" ? "bottom-1.5 -translate-x-1/2" : "left-2 -translate-y-1/2",
      )}
      style={axis === "x" ? { left: `${at}%` } : { top: `${at}%` }}
    >
      {children}
    </span>
  );
}

/** Zeichenfläche für Kurven mit Platz für die Achsen links und unten. */
export const PLOT = "absolute top-3 right-3 bottom-6 left-3";

/** Wie `PLOT`, mit Platz für eine beschriftete senkrechte Achse links. */
export const PLOT_Y = "absolute top-3 right-3 bottom-6 left-10";

/** Beschriftung der senkrechten Achse; `ticks` als [Position 0–100 von oben, Text]. */
export function YAxis({ ticks, bottom = 6 }: { ticks: [number, ReactNode][]; bottom?: number }) {
  return (
    <div className="pointer-events-none absolute top-3 left-0 w-10" style={{ bottom: bottom * 4 }}>
      {ticks.map(([at, text]) => (
        <Tick key={at} axis="y" at={at}>
          {text}
        </Tick>
      ))}
    </div>
  );
}

/** Gitterlinie im 0–100-Koordinatensystem der Anzeigen. */
export function GridLine({ x, y, strong }: { x?: number; y?: number; strong?: boolean }) {
  return (
    <line
      x1={x ?? 0}
      x2={x ?? 100}
      y1={y ?? 0}
      y2={y ?? 100}
      stroke="var(--muted-foreground)"
      strokeOpacity={strong ? ".4" : ".12"}
      strokeDasharray={strong ? "3 3" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** Kurve über die ganze Anzeige mit gefüllter Fläche bis `base` (0–100). */
export function Curve({ points, base, color = "var(--ch-mic)", fill = true }: { points: [number, number][]; base?: number; color?: string; fill?: boolean }) {
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <>
      {fill && base !== undefined && <polygon points={`${points[0][0]},${base} ${line} ${points.at(-1)![0]},${base}`} fill={color} fillOpacity=".16" />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </>
  );
}

/* ---------- Frequenzgang ---------- */

/** Höhe der EQ-Anzeige in dB je Richtung; etwas mehr als der Regelweg, damit die Griffe sichtbar bleiben. */
export const EQ_RANGE = 13;
const EQ_DB_TICKS = [12, 6, 0, -6, -12];
const EQ_FREQ_TICKS: [number, string][] = [
  [50, "50"],
  [200, "200"],
  [1000, "1k"],
  [5000, "5k"],
  [15000, "15k"],
];

/** Wo die drei Regler des EQ greifen, mit ihren Namen statt Frequenzen. */
const EQ_BANDS: [number, string][] = [
  [120, "effects.bass"],
  [2000, "effects.presence"],
  [11000, "effects.treble"],
];

/** 20 Hz … 20 kHz logarithmisch auf 0–100. */
export const freqX = (f: number) => (Math.log10(f / 20) / 3) * 100;

/**
 * Frequenzgang aus Tiefen-Shelf, Präsenz-Glocke und Höhen-Shelf, grob
 * angenähert; optional mit Low- und High-Cut (12 dB/Oktave).
 */
export function EqDisplay({
  low,
  mid,
  high,
  lowCut,
  highCut,
  color,
}: {
  low: number;
  mid: number;
  high: number;
  lowCut?: number;
  highCut?: number;
  color?: string;
}) {
  const points: [number, number][] = [];
  for (let i = 0; i <= 80; i++) {
    const x = i / 80;
    const f = 20 * Math.pow(1000, x);
    const lf = Math.log2(f);
    const shelfLow = low / (1 + Math.pow(2, (lf - Math.log2(120)) * 2));
    const shelfHigh = high / (1 + Math.pow(2, (Math.log2(8000) - lf) * 2));
    const bell = mid * Math.exp(-Math.pow(lf - Math.log2(2500), 2) / 1.2);
    let db = shelfLow + shelfHigh + bell;
    if (lowCut && lowCut > 20) db += 10 * Math.log10(1 / (1 + Math.pow(lowCut / f, 4)));
    if (highCut && highCut < 20000) db += 10 * Math.log10(1 / (1 + Math.pow(f / highCut, 4)));
    points.push([x * 100, Math.min(100, 50 - (Math.max(-EQ_RANGE * 1.2, db) / EQ_RANGE) * 50)]);
  }
  const dy = (db: number) => 50 - (db / EQ_RANGE) * 50;

  return (
    <>
      <div className={PLOT_Y}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {EQ_FREQ_TICKS.map(([f]) => (
            <GridLine key={f} x={freqX(f)} />
          ))}
          {EQ_DB_TICKS.map((db) => (
            <GridLine key={db} y={dy(db)} strong={db === 0} />
          ))}
          <Curve points={points} base={50} color={color} />
        </svg>
      </div>
      <YAxis ticks={EQ_DB_TICKS.map((v) => [dy(v), v > 0 ? `+${v}` : String(v)])} />
      <div className="pointer-events-none absolute right-3 bottom-0 left-10 h-6">
        {EQ_BANDS.map(([f, label], i) => (
          <Tick key={f} axis="x" at={freqX(f)}>
            {t(label)} {formatDb([low, mid, high][i])}
          </Tick>
        ))}
      </div>
    </>
  );
}

/* ---------- Raum ---------- */

/** Nachhallzeit grob aus Raumgröße und Dämpfung (Freeverb), in Sekunden. */
export function reverbSeconds(size: number, damping: number) {
  const feedback = 0.7 + size * 0.28;
  // Mittlere Kammlänge ~29 ms; −60 dB nach n Umläufen.
  const loops = Math.log(0.001) / Math.log(feedback * (1 - damping * 0.15));
  return loops * 0.029;
}

const REVERB_SPAN = 4;

/** Abklingen des Halls: Vorverzögerung, dann exponentiell bis −60 dB, über 4 s. */
export function ReverbDisplay({ size, damping, predelayMs, mix, color }: { size: number; damping: number; predelayMs: number; mix: number; color?: string }) {
  const seconds = reverbSeconds(size, damping);
  const start = (predelayMs / 1000 / REVERB_SPAN) * 100;
  const peak = 100 - 20 - mix * 70;
  const points: [number, number][] = [[start, 100]];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * REVERB_SPAN;
    const x = start + (t / REVERB_SPAN) * 100;
    if (x > 100) break;
    const level = Math.pow(0.001, t / seconds);
    points.push([x, 100 - (100 - peak) * Math.pow(level, 0.35)]);
  }
  const ticks = [0, 1, 2, 3, 4];
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((s) => (
            <GridLine key={s} x={(s / REVERB_SPAN) * 100} />
          ))}
          <line x1="0" x2="0" y1="100" y2={peak - 8} stroke="var(--foreground)" strokeOpacity=".6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <Curve points={points} base={100} color={color} />
        </svg>
      </div>
    </>
  );
}

const ECHO_SPAN = 2;

/** Wiederholungen des Echos als Striche über 2 s, jede leiser und dunkler. */
export function EchoDisplay({
  timeMs,
  feedback,
  toneHz,
  mix,
  color = "var(--ch-mic)",
}: {
  timeMs: number;
  feedback: number;
  toneHz: number;
  mix: number;
  color?: string;
}) {
  const taps: { x: number; h: number; o: number }[] = [];
  const darkening = Math.min(1, toneHz / 8000);
  for (let n = 1; n < 60; n++) {
    const t = (n * timeMs) / 1000;
    if (t > ECHO_SPAN) break;
    const level = mix * Math.pow(feedback, n - 1);
    if (level < 0.01) break;
    taps.push({ x: (t / ECHO_SPAN) * 100, h: level * 80, o: 0.35 + 0.65 * Math.pow(darkening, n - 1) });
  }
  const ticks = [0, 0.5, 1, 1.5, 2];
  return (
    <>
      <div className={PLOT}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {ticks.map((s) => (
            <GridLine key={s} x={(s / ECHO_SPAN) * 100} />
          ))}
          <line x1="0" x2="0" y1="100" y2="12" stroke="var(--foreground)" strokeOpacity=".6" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {taps.map((tap, i) => (
            <line
              key={i}
              x1={tap.x}
              x2={tap.x}
              y1="100"
              y2={100 - Math.max(2, tap.h)}
              stroke={color}
              strokeOpacity={tap.o}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </>
  );
}
