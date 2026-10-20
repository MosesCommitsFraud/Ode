import { useEffect, useState, type WheelEvent } from "react";
import { KnobHeadless, useKnobKeyboardControls } from "react-knob-headless";
import { Engraved } from "~/components/ui/hardware";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/*
 * Analoge Bedienelemente: Drehregler und Zeigerinstrument (VU-Nadel).
 * Drehregler (Verhalten aus react-knob-headless) reagieren auf Ziehen
 * (hoch/rechts = mehr), Mausrad, Pfeiltasten und Doppelklick (zurücksetzen). Fader, Tasten und
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
  /** Logarithmischer Weg, z. B. für Frequenzen; `min` muss dann über 0 liegen. */
  log?: boolean;
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
  log,
}: KnobProps) {
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Bipolare Regler ruhen in der Mitte, alle anderen am Anfang.
  const reset = resetValue ?? (bipolar ? (min + max) / 2 : min);
  const range = max - min;
  const round = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    // Logarithmische Regler runden auf zwei bis drei gültige Stellen statt auf feste Schritte.
    if (log) {
      const digits = Math.pow(10, Math.floor(Math.log10(clamped)) - (clamped < 1000 ? 1 : 2));
      return Number((Math.round(clamped / digits) * digits).toFixed(6));
    }
    return Number((Math.round((clamped - min) / step) * step + min).toFixed(6));
  };
  // Die Bibliothek braucht den ungerundeten Wert beim Ziehen; von außen gilt der gerundete.
  const [raw, setRaw] = useState(value);
  const shownRaw = round(raw) === value ? raw : value;
  const set = (v: number) => {
    setRaw(v);
    const next = round(v);
    if (next !== value) onChange(next);
  };
  const to01 = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : range > 0 ? (v - min) / range : 0);
  const from01 = (p: number) => (log ? min * Math.pow(max / min, p) : min + p * range);
  const keyboard = useKnobKeyboardControls({
    valueRaw: shownRaw,
    valueMin: min,
    valueMax: max,
    step: log ? shownRaw * 0.02 : step,
    stepLarger: log ? shownRaw * 0.2 : Math.max(step, Math.round(range / step / 10) * step),
    onValueRawChange: set,
  });

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const commit = (text: string) => {
    setEditing(false);
    const next = parse ? parse(text) : parseNumber(text, format(value));
    if (next !== null && Number.isFinite(next)) set(next);
  };
  const onWheel = (e: WheelEvent) => {
    if (disabled) return;
    const delta = (e.deltaY < 0 ? 1 : -1) / (e.shiftKey ? 200 : 50);
    set(from01(Math.min(1, Math.max(0, to01(shownRaw) + delta))));
  };

  const pos = Math.min(1, Math.max(0, to01(value)));
  const angle = START + pos * SWEEP;
  const origin = bipolar ? START + Math.min(1, Math.max(0, to01(reset))) * SWEEP : START;
  const [px, py] = polar(angle, 25);
  const [cx, cy] = polar(angle, 11);

  return (
    // Feste Breite: wechselnde Werte unter dem Regler verschieben nichts daneben.
    <div
      className={cn(
        "knob relative flex shrink-0 flex-col items-center gap-1 select-none",
        size === "sm" ? "w-16" : size === "lg" ? "w-24" : "w-20",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      {/* Ziehen, Tastatur und Bedienhilfen kommen aus react-knob-headless; Mausrad und Zurücksetzen von hier. */}
      <KnobHeadless
        aria-label={label}
        valueRaw={shownRaw}
        valueMin={min}
        valueMax={max}
        dragSensitivity={0.006}
        axis="xy"
        includeIntoTabOrder={!disabled}
        valueRawRoundFn={round}
        valueRawDisplayFn={(v) => format(round(v))}
        onValueRawChange={set}
        mapTo01={log ? (x) => to01(x) : undefined}
        mapFrom01={log ? (p) => from01(p) : undefined}
        onPointerDown={(e) => {
          // Strg-, Cmd- oder Alt-Klick setzt zurück, wie in den meisten Plugins.
          if (e.ctrlKey || e.metaKey || e.altKey) set(reset);
          else setDragging(true);
        }}
        onWheel={onWheel}
        onKeyDown={keyboard.onKeyDown}
        onDoubleClick={() => set(reset)}
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
      </KnobHeadless>
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
