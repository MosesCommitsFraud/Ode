import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";
import { demoNow, demoStarts } from "./store";

export type PlayMode = "restart" | "overlap" | "toggle";

export interface Sound {
  id: number;
  name: string;
  file: string;
  color: string;
  hotkey: string | null;
  volumeDb: number;
  category: string | null;
  favorite: boolean;
  playMode: PlayMode;
  trimStartMs: number;
  /** 0 = bis zum Ende. */
  trimEndMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  durationMs: number;
  /** Spitzenwerte 0–255. */
  waveform: number[];
  /** Absoluter Pfad zum Cover; in der Oberfläche mit convertFileSrc laden. */
  cover: string | null;
}

export type SoundPatch = Partial<
  Pick<
    Sound,
    | "name"
    | "color"
    | "hotkey"
    | "volumeDb"
    | "category"
    | "favorite"
    | "playMode"
    | "trimStartMs"
    | "trimEndMs"
    | "fadeInMs"
    | "fadeOutMs"
  >
>;

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "webm", "aiff", "caf"];

/** Kachelfarben; die Werte passen zu den Kanalfarben im Mischpult. */
export const SOUND_COLORS: Record<string, string> = {
  orange: "oklch(0.7 0.19 45)",
  amber: "oklch(0.8 0.16 80)",
  lime: "oklch(0.8 0.18 130)",
  emerald: "oklch(0.72 0.16 160)",
  cyan: "oklch(0.76 0.13 205)",
  blue: "oklch(0.64 0.18 255)",
  violet: "oklch(0.66 0.2 295)",
  pink: "oklch(0.7 0.2 350)",
};

export function soundColor(name: string) {
  return SOUND_COLORS[name] ?? SOUND_COLORS.orange;
}

interface LibraryState {
  sounds: Sound[];
  loaded: boolean;
  importing: number;
  /** Letzte Meldungen (Importfehler, belegte Hotkeys). */
  notices: string[];
}

let state: LibraryState = { sounds: [], loaded: false, importing: 0, notices: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<LibraryState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useLibrary<T>(selector: (s: LibraryState) => T): T {
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

function notify(notices: string[]) {
  if (notices.length > 0) set({ notices: [...notices, ...state.notices].slice(0, 5) });
}

function replace(sound: Sound) {
  set({ sounds: state.sounds.map((s) => (s.id === sound.id ? sound : s)) });
}

export const library = {
  async load() {
    if (!isTauri) {
      set({ sounds: demoSounds(), loaded: true });
      return;
    }
    try {
      const sounds = await invoke<Sound[]>("library_list");
      set({ sounds, loaded: true });
      notify(await invoke<string[]>("hotkey_errors"));
    } catch (e) {
      set({ loaded: true });
      notify([message(e)]);
    }
  },

  async pickFiles() {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Sounds hinzufügen",
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (picked) await library.importFiles(Array.isArray(picked) ? picked : [picked]);
  },

  async importFiles(paths: string[]) {
    const audio = paths.filter((p) =>
      AUDIO_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? ""),
    );
    const skipped = paths.length - audio.length;
    if (skipped > 0) notify([`${skipped} Datei(en) übersprungen – kein unterstütztes Audioformat`]);
    if (!isTauri || audio.length === 0) return;
    set({ importing: state.importing + audio.length });
    try {
      const result = await invoke<{ sounds: Sound[]; errors: string[] }>("library_import", {
        paths: audio,
      });
      set({ sounds: [...state.sounds, ...result.sounds] });
      notify(result.errors);
    } catch (e) {
      notify([message(e)]);
    } finally {
      set({ importing: Math.max(0, state.importing - audio.length) });
    }
  },

  async update(id: number, patch: SoundPatch) {
    // Sofort anzeigen, dann vom Backend bestätigen lassen.
    const current = state.sounds.find((s) => s.id === id);
    if (current) replace({ ...current, ...patch });
    if (!isTauri) return;
    try {
      const result = await invoke<{ sound: Sound; hotkeyErrors: string[] }>("library_update", {
        id,
        patch,
      });
      replace(result.sound);
      notify(result.hotkeyErrors);
    } catch (e) {
      if (current) replace(current);
      notify([message(e)]);
    }
  },

  async remove(id: number) {
    set({ sounds: state.sounds.filter((s) => s.id !== id) });
    if (isTauri) await invoke("library_delete", { id }).catch((e) => notify([message(e)]));
  },

  async play(id: number) {
    if (!isTauri) {
      demoStarts.set(id, demoNow());
      return;
    }
    await invoke("sound_play", { id }).catch((e) => notify([message(e)]));
  },

  /** Nur auf dem Kopfhörer abspielen, z. B. beim Zuschneiden im Editor. */
  async preview(id: number) {
    if (!isTauri) {
      demoStarts.set(id, demoNow());
      return;
    }
    await invoke("sound_preview", { id }).catch((e) => notify([message(e)]));
  },

  async stop(id: number) {
    if (!isTauri) return void demoStarts.delete(id);
    await invoke("sound_stop", { id }).catch(() => {});
  },

  async stopAll() {
    if (!isTauri) return demoStarts.clear();
    await invoke("sound_stop_all").catch(() => {});
  },

  dismissNotice(index: number) {
    set({ notices: state.notices.filter((_, i) => i !== index) });
  },
};

/** Beispiel-Sounds für die Vorschau im Browser. */
function demoSounds(): Sound[] {
  const names: [string, string, string | null, string | null, boolean][] = [
    ["Airhorn", "orange", "Numpad1", "Memes", true],
    ["Bruh", "amber", "Numpad2", "Memes", false],
    ["Applaus", "emerald", "Numpad3", "Reaktionen", true],
    ["Trommelwirbel", "violet", "Ctrl+Alt+KeyD", "Reaktionen", false],
    ["Sad Trombone", "blue", null, "Memes", false],
    ["Vine Boom", "pink", "Numpad5", "Memes", true],
    ["Wow", "cyan", null, "Reaktionen", false],
    ["Tada", "lime", "F13", null, false],
  ];
  return names.map(([name, color, hotkey, category, favorite], i) => ({
    id: i + 1,
    name,
    file: "",
    color,
    hotkey,
    volumeDb: 0,
    category,
    favorite,
    playMode: "restart",
    trimStartMs: 0,
    trimEndMs: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    durationMs: 1200 + i * 700,
    cover: null,
    waveform: Array.from({ length: 160 }, (_, j) =>
      Math.round(255 * Math.abs(Math.sin(j * (0.11 + i * 0.03)) * Math.exp(-j / (40 + i * 15)))),
    ),
  }));
}
