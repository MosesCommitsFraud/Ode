import type { ReactNode } from "react";

/* Kleine Strichzeichnungen für leere Seiten. Grundfarbe ist die gedämpfte
   Schrift, ein Detail trägt die Akzentfarbe der Seite. */

export type EmptyArt = "sounds" | "music" | "downloads" | "playlist";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Lautsprecher, der schläft. */
function Speaker() {
  return (
    <svg viewBox="0 0 120 100" className="h-28 w-auto">
      <rect x="28" y="22" width="56" height="70" rx="12" {...stroke} />
      <circle cx="56" cy="66" r="15" {...stroke} />
      <circle cx="56" cy="66" r="5" fill="var(--ch-soundboard)" />
      <path d="M46 38 q4 3 8 0 M60 38 q4 3 8 0" {...stroke} />
      <path d="M92 14 h10 l-10 10 h10 M100 0 h7 l-7 7 h7" {...stroke} strokeWidth={2} stroke="var(--ch-soundboard)" />
    </svg>
  );
}

/** Kassette mit Gähnen. */
function Cassette() {
  return (
    <svg viewBox="0 0 130 90" className="h-24 w-auto">
      <rect x="10" y="12" width="110" height="68" rx="10" {...stroke} />
      <rect x="26" y="26" width="78" height="26" rx="13" {...stroke} />
      <circle cx="42" cy="39" r="6" fill="var(--ch-music)" />
      <circle cx="88" cy="39" r="6" fill="var(--ch-music)" />
      <ellipse cx="65" cy="66" rx="7" ry="5" {...stroke} />
      <path d="M30 80 l6 -9 h58 l6 9" {...stroke} />
    </svg>
  );
}

/** Leere Kiste mit offenem Deckel. */
function Box() {
  return (
    <svg viewBox="0 0 130 100" className="h-28 w-auto">
      <path d="M25 42 L65 56 L105 42 L105 84 L65 98 L25 84 Z" {...stroke} />
      <path d="M65 56 V98" {...stroke} />
      <path d="M25 42 L10 26 L50 12 L65 28" {...stroke} />
      <path d="M105 42 L120 26 L80 12 L65 28" {...stroke} />
      <path d="M56 70 q4 -3 8 0 M70 70 q4 -3 8 0" {...stroke} strokeWidth={2} />
      <path d="M65 2 v10 M58 8 l7 6 l7 -6" {...stroke} stroke="var(--primary)" />
    </svg>
  );
}

/** Notenblatt, auf dem nur eine Note sitzt. */
function Sheet() {
  return (
    <svg viewBox="0 0 120 90" className="h-24 w-auto">
      {[24, 38, 52, 66].map((y) => (
        <path key={y} d={`M10 ${y} H110`} {...stroke} strokeWidth={2} opacity={0.6} />
      ))}
      <ellipse cx="62" cy="60" rx="8" ry="6" fill="var(--ch-music)" transform="rotate(-20 62 60)" />
      <path d="M69 57 V20 q8 4 14 12" {...stroke} stroke="var(--ch-music)" />
    </svg>
  );
}

const ART: Record<EmptyArt, () => ReactNode> = {
  sounds: Speaker,
  music: Cassette,
  downloads: Box,
  playlist: Sheet,
};

export function EmptyArtwork({ art }: { art: EmptyArt }) {
  const Art = ART[art];
  return (
    <div className="text-muted-foreground/45">
      <Art />
    </div>
  );
}
