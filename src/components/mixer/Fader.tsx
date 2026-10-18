import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "~/lib/utils";

const MIN_DB = -60;
const MAX_DB = 12;

/** Fader-Kurve: oben feiner aufgelöst, wie bei Hardware-Pulten. */
function dbToPosition(db: number) {
  if (db <= MIN_DB) return 0;
  return Math.pow((db - MIN_DB) / (MAX_DB - MIN_DB), 2.2);
}

function positionToDb(pos: number) {
  if (pos <= 0.001) return MIN_DB;
  const db = MIN_DB + Math.pow(pos, 1 / 2.2) * (MAX_DB - MIN_DB);
  return Math.round(db * 2) / 2;
}

const TICKS = [12, 6, 0, -6, -12, -24, -40];

export function Fader({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: number;
  onChange: (db: number) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
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
    <div className={cn("relative flex h-full w-9 justify-center", className)}>
      <div className="pointer-events-none absolute inset-y-2 right-0 w-2">
        {TICKS.map((db) => (
          <div
            key={db}
            className={cn("absolute right-0 h-px bg-border", db === 0 ? "w-2 bg-muted-foreground/50" : "w-1")}
            style={{ bottom: `${dbToPosition(db) * 100}%` }}
          />
        ))}
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
        className={cn(
          "group relative my-2 w-6 touch-none rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "opacity-50",
        )}
      >
        <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-meter-track" />
        <div
          className="absolute bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary"
          style={{ height: `${pos * 100}%` }}
        />
        <div
          className="absolute left-1/2 h-3 w-6 -translate-x-1/2 translate-y-1/2 rounded-[4px] border border-input bg-card shadow-sm group-active:border-primary"
          style={{ bottom: `${pos * 100}%` }}
        >
          <div className="absolute inset-x-1.5 top-1/2 h-px bg-muted-foreground/60" />
        </div>
      </div>
    </div>
  );
}
