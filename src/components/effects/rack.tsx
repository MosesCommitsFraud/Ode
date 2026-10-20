import type { ReactNode } from "react";
import { Badge, Card, Switch } from "~/components/ui/misc";
import { cn } from "~/lib/utils";

/* Bausteine der Effekt-Seiten: Module als Karten mit Anzeige und Reglern. */

/**
 * Ein Effekt als Karte: Kopf mit Schalter, große Anzeige, Regler darunter.
 * `columns` legt die Regler in ein Raster, sonst stehen sie untereinander.
 */
export function Module({
  title,
  enabled,
  onToggle,
  status,
  display,
  className,
  columns,
  children,
  accent,
}: {
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  status?: ReactNode;
  display: ReactNode;
  className?: string;
  columns?: number;
  children?: ReactNode;
  /** Farbe für Anzeige und Regler, z. B. die Kanalfarbe. */
  accent?: string;
}) {
  return (
    <Card
      className={cn("flex min-h-0 min-w-0 flex-col gap-3 p-4", className)}
      style={accent ? ({ "--ch-mic": accent } as React.CSSProperties) : undefined}
    >
      <div className="flex h-7 items-center gap-3">
        <Switch label={title} checked={enabled} onCheckedChange={onToggle} />
        <h3 className="min-w-0 flex-1 truncate font-display text-base font-semibold tracking-tight">{title}</h3>
        {status}
      </div>
      <div className={cn("well relative min-h-0 flex-1 overflow-hidden rounded-xl transition-opacity", !enabled && "opacity-40")}>
        {display}
      </div>
      {children && (
        <div
          className={columns ? "grid gap-x-3 gap-y-2.5" : "space-y-2.5"}
          style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        >
          {children}
        </div>
      )}
    </Card>
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

export function Reading({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "primary" }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** Zeichenfläche für Kurven mit Platz für die Achsen links und unten. */
export const PLOT = "absolute top-3 right-3 bottom-6 left-9";

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
      {fill && base !== undefined && (
        <polygon points={`${points[0][0]},${base} ${line} ${points.at(-1)![0]},${base}`} fill={color} fillOpacity=".16" />
      )}
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
      <div className="pointer-events-none absolute top-3 bottom-6 left-0 w-9">
        {EQ_DB_TICKS.map((db) => (
          <Tick key={db} axis="y" at={dy(db)}>
            {db > 0 ? `+${db}` : db}
          </Tick>
        ))}
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {EQ_FREQ_TICKS.map(([f, label]) => (
          <Tick key={f} axis="x" at={freqX(f)}>
            {label}
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
      <div className="pointer-events-none absolute top-3 right-3 font-mono text-[9px] text-muted-foreground/80 tabular-nums">
        {seconds.toFixed(1)} s
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {ticks.map((s) => (
          <Tick key={s} axis="x" at={(s / REVERB_SPAN) * 100}>
            {s} s
          </Tick>
        ))}
      </div>
    </>
  );
}

const ECHO_SPAN = 2;

/** Wiederholungen des Echos als Striche über 2 s, jede leiser und dunkler. */
export function EchoDisplay({ timeMs, feedback, toneHz, mix, color = "var(--ch-mic)" }: { timeMs: number; feedback: number; toneHz: number; mix: number; color?: string }) {
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
            <line key={i} x1={tap.x} x2={tap.x} y1="100" y2={100 - Math.max(2, tap.h)} stroke={color} strokeOpacity={tap.o} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-0 left-9 h-6">
        {ticks.map((s) => (
          <Tick key={s} axis="x" at={(s / ECHO_SPAN) * 100}>
            {s} s
          </Tick>
        ))}
      </div>
    </>
  );
}

/** Seitenwahl einer Effekt-Seite mit Aktionen rechts. */
export function PageBar({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2 pr-3 pl-6 pt-3 pb-3">{children}</div>;
}
