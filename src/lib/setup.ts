import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";
import { actions } from "./store";

export interface AppSettings {
  closeToTray: boolean;
  autostart: boolean;
  setupDone: boolean;
}

export interface CableStatus {
  installed: boolean;
  defaultOutputIsCable: boolean;
  installing: boolean;
  step: string | null;
  progress: number;
  error: string | null;
  restartRecommended: boolean;
}

interface SetupState {
  loaded: boolean;
  settings: AppSettings;
  cable: CableStatus;
  error: string | null;
}

let state: SetupState = {
  loaded: false,
  settings: { closeToTray: true, autostart: false, setupDone: true },
  cable: {
    installed: true,
    defaultOutputIsCable: false,
    installing: false,
    step: null,
    progress: 0,
    error: null,
    restartRecommended: false,
  },
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<SetupState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSetup<T>(selector: (s: SetupState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

let initialized = false;

export const setup = {
  async init() {
    if (initialized) return;
    initialized = true;
    if (!isTauri) {
      // Vorschau: Assistent mit ?setup im Link anzeigen.
      const show = location.search.includes("setup");
      set({
        loaded: true,
        settings: { ...state.settings, setupDone: !show },
        cable: { ...state.cable, installed: !show },
      });
      return;
    }
    await listen<CableStatus>("cable://status", (e) => {
      set({ cable: e.payload });
      // Neues Gerät: Liste neu laden, damit das Kabel auswählbar ist.
      if (e.payload.installed) void actions.refreshDevices();
    });
    const [settings, cable] = await Promise.all([
      invoke<AppSettings>("app_settings"),
      invoke<CableStatus>("cable_status"),
    ]);
    set({ loaded: true, settings, cable });
  },

  async refreshCable() {
    if (!isTauri) return;
    set({ cable: await invoke<CableStatus>("cable_status") });
  },

  async installCable() {
    if (!isTauri) {
      set({ cable: { ...state.cable, installing: true, step: "Treiberpaket wird geladen" } });
      setTimeout(() => set({ cable: { ...state.cable, installing: false, installed: true, defaultOutputIsCable: true } }), 1500);
      return;
    }
    set({ cable: { ...state.cable, installing: true, error: null } });
    await invoke("cable_install");
  },

  async openSoundSettings() {
    if (isTauri) await invoke("open_sound_settings");
  },

  async update(patch: Partial<AppSettings>) {
    const settings = { ...state.settings, ...patch };
    set({ settings, error: null });
    if (!isTauri) return;
    try {
      set({ settings: await invoke<AppSettings>("set_app_settings", { settings }) });
    } catch (e) {
      set({ error: typeof e === "string" ? e : String(e) });
    }
  },

  async quit() {
    if (isTauri) await invoke("quit_app");
  },
};
