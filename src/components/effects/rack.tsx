import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activator } from "~/components/ui/hardware";
import { HelpIcon } from "./HelpDrawer";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/* Bausteine der Effekt-Seiten: Module als Karten mit Anzeige und Reglern. */

/**
 * Ein Effekt als Gerät im Pult: Aktivierungsknopf vor dem Namen, ein Fenster,
 * das zeigt, was das Gerät tut, darunter Tasten, Drehregler und Fader. Aus ist
 * das Gerät blass und grau, an trägt es seine Farbe.
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
  grow = 1,
  framed,
}: {
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  display: ReactNode;
  className?: string;
  /** Bedienelemente in einer Reihe; Fader nehmen die volle Höhe, `Stack` stapelt Drehregler. */
  children?: ReactNode;
  /** Farbe für Anzeige und Regler, z. B. die Kanalfarbe. */
  accent?: string;
  /** Werkzeug für die Erklärung hinter dem „?“ am Titel (siehe i18n/help.ts). */
  help?: string;
  /** Tasten über den Reglern, z. B. Modus oder Tonart; volle Breite. */
  keys?: ReactNode;
  /** Anteil an der Breite im Pult, nach Menge der Bedienelemente. */
  grow?: number;
  /** Als eigene Karte statt als Zug in einem `Console`. */
  framed?: boolean;
}) {
  // Ohne eigene Farbe bleibt --ch-mic geerbt; sich selbst zuweisen wäre ungültig.
  const style: Record<string, string | number> = accent ? { "--ch-mic": accent, "--ch": accent, flexGrow: grow } : { "--ch": "var(--ch-mic)", flexGrow: grow };
  return (
    <section style={style} className={cn("flex min-h-0 min-w-0 basis-0 flex-col gap-3 px-3 pt-3.5 pb-3", framed && "panel rounded-2xl", className)}>
      <div className="flex h-7 shrink-0 items-center gap-1">
        <Activator label={title} on={enabled} onChange={onToggle} />
        <h3 className={cn("min-w-0 truncate font-display text-[17px] font-semibold tracking-tight transition-colors duration-300", !enabled && "text-muted-foreground")}>
          {title}
        </h3>
        {help && <HelpIcon topic={help} />}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col gap-3 transition-[opacity,filter] duration-300", !enabled && "opacity-50 grayscale")}>
        <div className={cn("well relative overflow-hidden rounded-lg", children ? "h-[clamp(72px,16vh,150px)] shrink-0" : "min-h-0 flex-1")}>{display}</div>
        {keys && <div className="flex shrink-0 flex-col gap-2">{keys}</div>}
        {children && <div className="flex min-h-0 flex-1 items-stretch justify-evenly gap-2 [&>*]:min-w-0">{children}</div>}
      </div>
    </section>
  );
}

/** Drehregler übereinander, gleichmäßig über die Höhe verteilt. */
export function Stack({ children }: { children: ReactNode }) {
  // Reicht die Höhe nicht, laufen die übrigen in eine zweite Spalte.
  return (
    <div className="grid min-h-0 grid-flow-col content-evenly items-center justify-items-center gap-x-3" style={{ gridTemplateRows: "repeat(auto-fit, minmax(84px, max-content))" }}>
      {children}
    </div>
  );
}

/** Mehrere Geräte nebeneinander auf einem Pult, getrennt durch feine Linien. */
export function Console({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("panel flex min-h-0 flex-1 divide-x divide-hairline rounded-2xl p-1.5", className)}>{children}</div>;
}

/**
 * Weicher Wechsel zwischen Seiten: die alte blendet aus, während die neue
 * schon darüber einblendet; nie ein leerer Moment. Die Richtung folgt der
 * Reihenfolge in `order`.
 */
export function Crossfade({ id, order, children, className }: { id: string; order: string[]; children: ReactNode; className?: string }) {
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

  const dir = leaving?.dir ?? 1;
  return (
    <div className={cn("relative grid min-h-0 flex-1", className)} style={{ "--dir": dir } as React.CSSProperties}>
      {leaving && (
        <div key={leaving.id} aria-hidden className="pointer-events-none col-start-1 row-start-1 flex min-h-0 animate-[page-out_280ms_ease-in_forwards]">
          {leaving.node}
        </div>
      )}
      <div key={id} className={cn("col-start-1 row-start-1 flex min-h-0", leaving && "animate-[page-in_320ms_var(--ease-drawer)]")}>
        {children}
      </div>
    </div>
  );
}

/** Beschriftung einer Achse; `at` ist die Position in Prozent. */
export function Tick({ at, axis, children }: { at: number; axis: "x" | "y"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute font-mono text-[9px] leading-none whitespace-nowrap text-muted-foreground/70 tabular-nums",
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

const EQ_RANGE = 15;
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
  [90, "effects.bass"],
  [1200, "effects.presence"],
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
      <div className={PLOT}>
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
      <div className="pointer-events-none absolute right-3 bottom-0 left-3 h-6">
        {EQ_BANDS.map(([f, label]) => (
          <Tick key={f} axis="x" at={freqX(f)}>
            {t(label)}
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
