/*
 * Abspiel-Symbole, optisch zentriert. Ein Dreieck in einer mittigen Box wirkt
 * nach links versetzt, weil die meiste Fläche links sitzt; hier liegt der
 * Schwerpunkt in der Mitte. Größe und Farbe kommen wie bei den Icons von außen
 * (size-* und currentColor).
 */

export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <path d="M5.2 3.1v9.8c0 .6.6.9 1.1.6l7.4-4.9c.4-.3.4-.9 0-1.2L6.3 2.5c-.5-.3-1.1 0-1.1.6Z" fill="currentColor" />
    </svg>
  );
}

export function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="3.5" y="2.75" width="3.25" height="10.5" rx="1" fill="currentColor" />
      <rect x="9.25" y="2.75" width="3.25" height="10.5" rx="1" fill="currentColor" />
    </svg>
  );
}

export function StopGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.75" fill="currentColor" />
    </svg>
  );
}
