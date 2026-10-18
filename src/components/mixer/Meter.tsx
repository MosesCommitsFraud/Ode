import { useRef } from "react";
import { cn, gainToDb } from "~/lib/utils";

const FLOOR = -60;
/** Abfall der Anzeige pro Update (ca. 30 Hz) in dB. */
const FALL_DB = 1.6;
const HOLD_UPDATES = 30;

function dbToFraction(db: number) {
  return Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR));
}

/** Teilt den Balken in LED-Segmente. */
const SEGMENTS_V = "repeating-linear-gradient(to top, #000 0 3px, transparent 3px 5px)";
const SEGMENTS_H = "repeating-linear-gradient(to right, #000 0 3px, transparent 3px 5px)";

/**
 * Pegelanzeige in dBFS als LED-Kette: Kanalfarbe bis −12 dB, gelb bis −3 dB, darüber rot.
 * Fällt weich ab und hält die Spitze kurz. Die Kanalfarbe kommt aus `--ch`.
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
  const dir = vertical ? "to top" : "to right";
  const mask = vertical ? SEGMENTS_V : SEGMENTS_H;

  return (
    <div className={cn("relative", vertical ? "w-2" : "h-2", className)}>
      <div
        className="absolute inset-0 bg-[var(--led-off)]"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      <div
        className="absolute inset-0"
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          background: `linear-gradient(${dir}, var(--ch, var(--success)) 0%, var(--ch, var(--success)) 80%, var(--warning) 80%, var(--warning) 95%, var(--error) 95%)`,
          clipPath: vertical ? `inset(${(1 - level) * 100}% 0 0 0)` : `inset(0 ${(1 - level) * 100}% 0 0)`,
        }}
      />
      {held > 0.02 && (
        <div
          className={cn("absolute rounded-full bg-foreground", vertical ? "inset-x-0 h-0.5" : "inset-y-0 w-0.5")}
          style={vertical ? { bottom: `${held * 100}%` } : { left: `${held * 100}%` }}
        />
      )}
    </div>
  );
}
