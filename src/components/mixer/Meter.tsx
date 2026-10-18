import { useRef } from "react";
import { cn, gainToDb } from "~/lib/utils";

const FLOOR = -60;
/** Abfall der Anzeige pro Update (ca. 30 Hz) in dB. */
const FALL_DB = 1.6;
const HOLD_UPDATES = 30;

function dbToFraction(db: number) {
  return Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR));
}

/**
 * Pegelanzeige in dBFS: grün bis −12 dB, gelb bis −3 dB, darüber rot.
 * Fällt weich ab und hält die Spitze kurz.
 */
export function Meter({
  peak,
  orientation = "vertical",
  className,
}: {
  peak: number;
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const display = useRef(FLOOR);
  const hold = useRef({ db: FLOOR, age: 0 });

  const db = gainToDb(peak, FLOOR);
  display.current = Math.max(db, display.current - FALL_DB);
  if (db >= hold.current.db || hold.current.age > HOLD_UPDATES) {
    hold.current = { db, age: 0 };
  } else {
    hold.current.age += 1;
  }

  const level = dbToFraction(display.current);
  const held = dbToFraction(hold.current.db);
  const vertical = orientation === "vertical";
  const gradient = vertical
    ? "bg-[linear-gradient(to_top,var(--success)_0%,var(--success)_80%,var(--warning)_80%,var(--warning)_95%,var(--error)_95%)]"
    : "bg-[linear-gradient(to_right,var(--success)_0%,var(--success)_80%,var(--warning)_80%,var(--warning)_95%,var(--error)_95%)]";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[3px] bg-meter-track",
        vertical ? "w-1.5" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn("absolute inset-0", gradient)}
        style={{
          clipPath: vertical
            ? `inset(${(1 - level) * 100}% 0 0 0)`
            : `inset(0 ${(1 - level) * 100}% 0 0)`,
        }}
      />
      {held > 0.01 && (
        <div
          className={cn(
            "absolute bg-foreground/60",
            vertical ? "inset-x-0 h-px" : "inset-y-0 w-px",
          )}
          style={vertical ? { bottom: `${held * 100}%` } : { left: `${held * 100}%` }}
        />
      )}
    </div>
  );
}
