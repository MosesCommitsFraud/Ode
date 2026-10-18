import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "3xs"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Linearer Pegel → dBFS, mit Untergrenze. */
export function gainToDb(gain: number, floor = -60) {
  if (gain <= 0) return floor;
  return Math.max(floor, 20 * Math.log10(gain));
}

export function formatDb(db: number, floor = -60) {
  if (db <= floor) return "−∞";
  const rounded = db.toFixed(1);
  return db > 0 ? `+${rounded}` : rounded.replace("-", "−");
}
