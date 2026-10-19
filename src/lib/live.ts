import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";

/** Ein Programm mit Ton, z. B. Spotify oder ein Browser. */
export interface AppSource {
  pid: number;
  name: string;
  exe: string;
  /** Spielt gerade hörbar etwas ab. */
  playing: boolean;
  /** Programm-Icon als PNG-Data-URL (32 × 32), direkt als <img src> nutzbar. */
  icon: string | null;
}

interface LiveState {
  sources: AppSource[];
  /** Läuft gerade als Live-Quelle im Musik-Kanal. */
  active: AppSource | null;
  loading: boolean;
  error: string | null;
}

let state: LiveState = { sources: [], active: null, loading: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useLive<T>(selector: (s: LiveState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

function message(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

const DEMO: AppSource[] = [
  { pid: 1, name: "Spotify", exe: "Spotify.exe", playing: true, icon: null },
  { pid: 2, name: "Chrome", exe: "chrome.exe", playing: false, icon: null },
  { pid: 3, name: "Discord", exe: "Discord.exe", playing: false, icon: null },
];

export const live = {
  /** Programme mit Ton neu einlesen (z. B. beim Öffnen der Auswahl). */
  async refresh() {
    set({ loading: true, error: null });
    try {
      const sources = isTauri ? await invoke<AppSource[]>("live_sources") : DEMO;
      const status = isTauri ? await invoke<{ source: AppSource | null }>("live_status") : { source: state.active };
      set({ sources, active: status.source, loading: false });
    } catch (e) {
      set({ loading: false, error: message(e) });
    }
  },

  /** Ton dieses Programms auf den Musik-Kanal legen. */
  async start(source: AppSource) {
    set({ error: null });
    if (!isTauri) return set({ active: source });
    try {
      const status = await invoke<{ source: AppSource | null }>("live_start", { source });
      set({ active: status.source });
    } catch (e) {
      set({ active: null, error: message(e) });
    }
  },

  async stop() {
    set({ active: null });
    if (isTauri) await invoke("live_stop");
  },
};
