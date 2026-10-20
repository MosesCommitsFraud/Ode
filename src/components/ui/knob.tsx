import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Engraved } from "~/components/ui/hardware";
import { t } from "~/lib/i18n";
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
  /** Früher Skalenstriche; der flache Regler zeigt keine. */
  ticks?: number;
  size?: "sm" | "md" | "lg";
  /** Getippten Wert lesen; ohne liest `parseNumber` anhand der Einheit in `format`. */
  parse?: (text: string) => number | null;
}

/**
 * Zahl aus getipptem Text, passend zur Einheit der Anzeige (`sample`):
 * „6k“ oder „6“ bei kHz → 6000, „50“ bei % → 0,5; Komma und Minuszeichen
 * werden verstanden.
 */
export function parseNumber(text: string, sample: string): number | null {
  const clean = text.trim().toLowerCase().replace(",", ".").replace("−", "-");
  let n = parseFloat(clean.replace(/^\+/, ""));
  if (Number.isNaN(n)) return null;
  if (/\d\s*k/.test(clean) || (sample.includes("kHz") && Math.abs(n) < 100)) n *= 1000;
  if (sample.includes("%")) n /= 100;
  return n;
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
  size = "md",
  parse,
}: KnobProps) {
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
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
    // Strg-, Cmd- oder Alt-Klick setzt zurück, wie in den meisten Plugins.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      set(reset);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, x: e.clientX, value };
    setDragging(true);
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
    setDragging(false);
  };
  const commit = (text: string) => {
    setEditing(false);
    const next = parse ? parse(text) : parseNumber(text, format(value));
    if (next !== null && Number.isFinite(next)) set(next);
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

  const [px, py] = polar(angle, 25);
  const [cx, cy] = polar(angle, 11);

  return (
    // Feste Breite: wechselnde Werte unter dem Regler verschieben nichts daneben.
    <div className={cn("knob relative flex shrink-0 flex-col items-center gap-1 select-none", size === "sm" ? "w-16" : size === "lg" ? "w-24" : "w-20", disabled && "opacity-45")}>
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
          "knob-dial relative shrink-0 cursor-default touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "size-9" : size === "lg" ? "size-16" : "size-12",
        )}
      >
        {/* Flach wie in modernen Plugins: Bahn mit Wertbogen, darin eine Scheibe mit Zeiger. */}
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <path d={arc(START, START + SWEEP, 44)} fill="none" stroke="var(--meter-track)" strokeWidth="8" strokeLinecap="round" />
          <path
            d={arc(Math.min(origin, angle), Math.max(origin, angle), 44)}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            className={cn("transition-opacity", disabled && "opacity-50")}
          />
          <circle cx="50" cy="50" r="31" fill="var(--panel-raised)" stroke="var(--hairline)" strokeWidth="1.5" />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="var(--foreground)" strokeWidth="5" strokeLinecap="round" />
        </svg>
      </div>
      {/* Beim Ziehen steht der Wert groß über dem Regler. */}
      {dragging && (
        <span className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-background tabular-nums shadow-md">
          {format(value)}
        </span>
      )}
      <div className="w-full min-w-0 text-center">
        <Engraved>{label}</Engraved>
        {editing ? (
          <input
            autoFocus
            defaultValue={format(value)}
            aria-label={label}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-[15px] w-full rounded-[4px] bg-panel-raised text-center font-mono text-2xs leading-tight tabular-nums shadow-[0_0_0_1px_var(--ch-mic)] outline-none"
          />
        ) : (
          <button
            type="button"
            title={t("common.typeValue")}
            disabled={disabled}
            onClick={() => setEditing(true)}
            className="block w-full cursor-text truncate rounded-[4px] font-mono text-2xs leading-tight tabular-nums hover:bg-accent"
          >
            {format(value)}
          </button>
        )}
      </div>
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
