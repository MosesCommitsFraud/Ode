import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";

export const MIN_DB = -60;
export const MAX_DB = 12;

/** Fader-Kurve: oben feiner aufgelöst, wie bei Hardware-Pulten. */
export function dbToPosition(db: number) {
  if (db <= MIN_DB) return 0;
  return Math.pow((db - MIN_DB) / (MAX_DB - MIN_DB), 2.2);
}

export function positionToDb(pos: number) {
  if (pos <= 0.001) return MIN_DB;
  const db = MIN_DB + Math.pow(pos, 1 / 2.2) * (MAX_DB - MIN_DB);
  return Math.round(db * 2) / 2;
}

const SCALE = [12, 6, 0, -6, -12, -24, -40];

/**
 * Senkrechter Fader mit aufgedruckter dB-Skala. Die Füllung leuchtet in der
 * Kanalfarbe (`--ch`); `meter` sitzt direkt neben der Schiene.
 */
export function Fader({
  value,
  onChange,
  disabled,
  label,
  meter,
  size = "default",
  className,
}: {
  value: number;
  onChange: (db: number) => void;
  disabled?: boolean;
  label: string;
  meter?: ReactNode;
  /** "sm" für das kleine Pult in der Sidebar. */
  size?: "default" | "sm";
  className?: string;
}) {
  const sm = size === "sm";
  const track = useRef<HTMLDivElement>(null);
  const pos = dbToPosition(value);

  const update = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const p = 1 - (clientY - rect.top) / rect.height;
    onChange(positionToDb(Math.min(1, Math.max(0, p))));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientY);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e.clientY);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 1;
    if (e.key === "ArrowUp") onChange(Math.min(MAX_DB, value + step));
    else if (e.key === "ArrowDown") onChange(Math.max(MIN_DB, value - step));
    else if (e.key === "Home") onChange(0);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn("flex h-full items-stretch gap-1.5 py-3", className)}>
      {/* Skala */}
      <div className="relative w-5 font-mono text-[9px] text-muted-foreground/70 tabular-nums">
        {SCALE.map((db) => (
          <span
            key={db}
            className={cn("absolute right-0 translate-y-1/2 leading-none", db === 0 && "font-semibold text-foreground")}
            style={{ bottom: `${dbToPosition(db) * 100}%` }}
          >
            {db > 0 ? `+${db}` : db === 0 ? "0" : `${Math.abs(db)}`}
          </span>
        ))}
        <span className="absolute right-0 bottom-0 translate-y-1/2 leading-none">∞</span>
      </div>

      <div
        ref={track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={MIN_DB}
        aria-valuemax={MAX_DB}
        aria-valuenow={value}
        aria-orientation="vertical"
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={() => !disabled && onChange(0)}
        onKeyDown={onKeyDown}
        className={cn("group relative touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", sm ? "w-6" : "w-9")}
      >
        {/* Rillen links und rechts der Schiene */}
        {SCALE.map((db) => (
          <span
            key={db}
            className={cn(
              "absolute left-1/2 h-px -translate-x-1/2 bg-muted-foreground/25",
              db === 0 ? (sm ? "w-6 bg-muted-foreground/50" : "w-9 bg-muted-foreground/50") : sm ? "w-4" : "w-6",
            )}
            style={{ bottom: `${dbToPosition(db) * 100}%` }}
          />
        ))}
        <div className="well absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full" />
        <div
          className="absolute bottom-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-[var(--ch)]"
          style={{ height: `${pos * 100}%`, opacity: disabled ? 0.35 : 1 }}
        />
        {/* Kappe */}
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 translate-y-1/2 transition-transform duration-100",
            sm ? "h-4 w-6 rounded-[5px]" : "h-[26px] w-9 rounded-[7px]",
            "bg-[linear-gradient(to_bottom,oklch(98%_0.003_75),oklch(86%_0.006_75))] dark:bg-[linear-gradient(to_bottom,oklch(40%_0.006_60),oklch(26%_0.006_60))]",
            "shadow-[0_1px_0_oklch(100%_0_0/35%)_inset,0_6px_14px_-4px_oklch(0%_0_0/55%),0_0_0_1px_oklch(0%_0_0/18%)]",
            !disabled && "group-hover:scale-105 group-active:scale-95",
          )}
          style={{ bottom: `${pos * 100}%` }}
        >
          {!sm && <span className="absolute inset-x-1 top-[5px] h-px bg-black/10 dark:bg-white/8" />}
          <span className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--ch)]" />
          {!sm && <span className="absolute inset-x-1 bottom-[5px] h-px bg-black/10 dark:bg-white/8" />}
        </div>
      </div>

      {meter}
    </div>
  );
}
