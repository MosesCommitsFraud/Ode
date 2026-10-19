import { useRef } from "react";
import { LedBar } from "~/components/ui/canvas";
import { cn, gainToDb } from "~/lib/utils";

const FLOOR = -60;
/** Abfall der Anzeige pro Update (ca. 30 Hz) in dB. */
const FALL_DB = 1.6;
const HOLD_UPDATES = 30;

function dbToFraction(db: number) {
  return Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR));
}

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

  return (
    <LedBar
      orientation={orientation}
      color={(pos) => (pos > level ? "off" : pos > 0.95 ? "error" : pos > 0.8 ? "warning" : "on")}
      marker={held > 0.02 ? held : null}
      deps={[level]}
      className={cn(vertical ? "h-full min-h-0 w-2" : "h-2 w-full", className)}
    />
  );
}
