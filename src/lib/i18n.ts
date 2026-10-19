/**
 * Übersetzungen (Deutsch, Englisch). Texte liegen je Bereich in
 * src/i18n/<bereich>.ts; Schlüssel sind „bereich.name“, z. B.
 * t("soundboard.add"). Platzhalter: t("music.trackCount", { count: 3 }) mit
 * „{count} Titel“ im Wörterbuch. Fehlt eine Übersetzung, gilt Deutsch, dann der
 * Schlüssel selbst.
 */
import { useSyncExternalStore } from "react";
import { dictionaries } from "~/i18n";

export type Lang = "de" | "en";
export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
];

const STORAGE_KEY = "ode.lang";

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "de" || stored === "en") return stored;
  } catch {
    // Kein Speicher: Systemsprache nehmen.
  }
  return typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("de") ? "en" : "de";
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

function lookup(language: Lang, key: string): string | undefined {
  const [area, ...rest] = key.split(".");
  const entry = dictionaries[area]?.[language];
  return entry?.[rest.join(".")];
}

/** Übersetzt einen Schlüssel; außerhalb von React (z. B. in lib/*.ts) nutzbar. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = lookup(lang, key) ?? lookup("de", key) ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function getLang(): Lang {
  return lang;
}

/** Sprache wechseln; die Oberfläche zeichnet sich neu. */
export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Nur Komfort.
  }
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

/** Aktuelle Sprache; Komponenten mit diesem Hook zeichnen sich beim Wechsel neu. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lang,
  );
}

/** `t` als Hook: Komponente aktualisiert sich beim Sprachwechsel. */
export function useT() {
  useLang();
  return t;
}

/** Sprache im Datumsformat (z. B. für toLocaleString). */
export function locale(): string {
  return lang === "de" ? "de-DE" : "en-US";
}

if (typeof document !== "undefined") document.documentElement.lang = lang;
