import { useId, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Caption } from "~/components/ui/hardware";
import { cn } from "~/lib/utils";

/*
 * Analoge Bedienelemente: Drehregler und Zeigerinstrument (VU-Nadel).
 * Drehregler reagieren auf Ziehen (hoch/rechts = mehr, Shift = fein),
 * Mausrad, Pfeiltasten und Doppelklick (zurücksetzen). Fader, Tasten und
 * Kippschalter liegen in hardware.tsx.
 */

/** Drehweg: 270°, von links unten nach rechts unten. */
const SWEEP = 270;
const START = -135;

function polar(angle: number, radius: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(rad), 50 + radius * Math.sin(rad)] as const;
}

function arc(from: number, to: number, radius: number) {
  if (Math.abs(to - from) < 0.01) return "";
  const [x1, y1] = polar(from, radius);
  const [x2, y2] = polar(to, radius);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} ${sweep} ${x2} ${y2}`;
}

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Wert für Doppelklick. */
  reset?: number;
  disabled?: boolean;
  /** Farbe des Wert-Bogens. */
  color?: string;
  /** Bogen von der Mitte (bzw. `reset`) statt vom Anfang, z. B. für ±dB. */
  bipolar?: boolean;
  /** Anzahl Skalenstriche; bei Stufenschaltern eine pro Stufe. */
  ticks?: number;
  size?: "sm" | "md";
}

export function Knob({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  reset: resetValue,
  disabled,
  color = "var(--ch-mic)",
  bipolar,
  ticks = 11,
  size = "md",
}: KnobProps) {
  const id = useId();
  // Bipolare Regler ruhen in der Mitte, alle anderen am Anfang.
  const reset = resetValue ?? (bipolar ? (min + max) / 2 : min);
  const drag = useRef<{ y: number; x: number; value: number } | null>(null);
  const range = max - min;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const set = (v: number) => {
    const next = clamp(v);
    if (next !== value) onChange(Number(next.toFixed(6)));
  };

  const pos = range > 0 ? (value - min) / range : 0;
  const angle = START + pos * SWEEP;
  const origin = bipolar ? START + ((reset - min) / range) * SWEEP : START;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, x: e.clientX, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 180 px für den ganzen Weg, mit Shift viermal feiner.
    const moved = (d.y - e.clientY + (e.clientX - d.x)) / (e.shiftKey ? 720 : 180);
    set(d.value + moved * range);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent) => {
    if (disabled) return;
    const steps = Math.max(1, Math.round(range / step / (e.shiftKey ? 200 : 50)));
    set(value + (e.deltaY < 0 ? 1 : -1) * steps * step);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    const big = Math.max(step, Math.round(range / step / 10) * step);
    const delta: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: big,
      PageDown: -big,
    };
    if (e.key in delta) set(value + delta[e.key]);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else return;
    e.preventDefault();
  };

  const [px, py] = polar(angle, 23);
  const [cx, cy] = polar(angle, 9);
  const marks = Array.from({ length: ticks }, (_, i) => START + (i / Math.max(1, ticks - 1)) * SWEEP);

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1 select-none", disabled && "opacity-45")}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDoubleClick={() => !disabled && set(reset)}
        className={cn(
          "relative shrink-0 cursor-default touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "size-9" : "size-12",
        )}
      >
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <defs>
            <radialGradient id={`${id}-cap`} cx="38%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--knob-hi)" />
              <stop offset="100%" stopColor="var(--knob-lo)" />
            </radialGradient>
          </defs>
          {marks.map((a) => {
            const [x1, y1] = polar(a, 47);
            const [x2, y2] = polar(a, 50);
            return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted-foreground)" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />;
          })}
          <path d={arc(START, START + SWEEP, 40)} fill="none" stroke="var(--meter-track)" strokeWidth="6" strokeLinecap="round" />
          <path d={arc(Math.min(origin, angle), Math.max(origin, angle), 40)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
          {/* Kappe mit Griffrand, darauf der Zeiger. */}
          <circle cx="50" cy="52" r="30" fill="oklch(0% 0 0 / 30%)" />
          <circle cx="50" cy="50" r="30" fill={`url(#${id}-cap)`} stroke="var(--hairline)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="24" fill="none" stroke="oklch(100% 0 0 / 6%)" strokeWidth="1" />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="var(--foreground)" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      </div>
      <Caption label={label} value={format(value)} />
    </div>
  );
}

/**
 * Zeigerinstrument wie ein VU-Meter: Skala im Halbkreis, Zeiger mit etwas
 * Trägheit. `value` 0–1 über die Skala; `danger` ab dort ist die Skala rot.
 */
export function Needle({
  value,
  scale,
  danger,
  marker,
  label,
  className,
}: {
  value: number;
  /** Beschriftungen an Positionen 0–1. */
  scale: [number, string][];
  danger?: number;
  /** Markierung auf der Skala (0–1), z. B. eine Schwelle. */
  marker?: number;
  label?: string;
  className?: string;
}) {
  const span = 100;
  const angleOf = (p: number) => -span / 2 + Math.min(1, Math.max(0, p)) * span;
  // Drehpunkt unterhalb der Skala, wie bei echten Instrumenten.
  const pivot = { x: 50, y: 64 };
  const point = (a: number, r: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [pivot.x + r * Math.cos(rad), pivot.y + r * Math.sin(rad)] as const;
  };
  const scaleArc = (from: number, to: number, r: number) => {
    const [x1, y1] = point(angleOf(from), r);
    const [x2, y2] = point(angleOf(to), r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <div className={cn("relative", className)}>
      <svg viewBox="4 6 92 54" preserveAspectRatio="xMidYMid meet" className="size-full overflow-hidden">
        <path d={scaleArc(0, danger ?? 1, 50)} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".55" strokeWidth=".8" />
        {danger !== undefined && <path d={scaleArc(danger, 1, 50)} fill="none" stroke="var(--error)" strokeWidth="2.2" />}
        {scale.map(([p, text]) => {
          const [x1, y1] = point(angleOf(p), 50);
          const [x2, y2] = point(angleOf(p), 46);
          const [lx, ly] = point(angleOf(p), 55);
          return (
            <g key={p}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted-foreground)" strokeOpacity=".7" strokeWidth=".8" />
              <text x={lx} y={ly + 1.5} textAnchor="middle" fontSize="4" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">
                {text}
              </text>
            </g>
          );
        })}
        {marker !== undefined &&
          (() => {
            const [x1, y1] = point(angleOf(marker), 44);
            const [x2, y2] = point(angleOf(marker), 53);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ch-mic)" strokeWidth="1.6" strokeLinecap="round" />;
          })()}
        {label && (
          <text x="50" y="44" textAnchor="middle" fontSize="4.5" fill="var(--muted-foreground)" fontFamily="var(--font-mono)" letterSpacing=".6">
            {label}
          </text>
        )}
        <line
          x1={pivot.x}
          y1={pivot.y}
          x2={pivot.x}
          y2={pivot.y - 51}
          stroke="var(--foreground)"
          strokeWidth="1"
          strokeLinecap="round"
          style={{
            transform: `rotate(${angleOf(value)}deg)`,
            transformBox: "view-box",
            transformOrigin: `${pivot.x}px ${pivot.y}px`,
            transition: "transform 160ms cubic-bezier(.3,.7,.4,1)",
          }}
        />
        <circle cx={pivot.x} cy={pivot.y} r="7" fill="var(--knob-lo)" stroke="var(--hairline)" />
      </svg>
    </div>
  );
}
