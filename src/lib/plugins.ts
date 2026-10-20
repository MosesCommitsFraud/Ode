import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";
import { t } from "./i18n";

/* Externe CLAP-Plugins im Plugin-Slot der Mikrofon-Kette (Prototyp, nur mit
   dem Cargo-Feature „plugins“ eingebaut; sonst bleibt die Seite verborgen). */

export interface PluginInfo {
  path: string;
  id: string;
  name: string;
  vendor: string;
  version: string;
}

export interface ParamDesc {
  id: number;
  name: string;
  module: string;
  min: number;
  max: number;
  default: number;
  value: number;
  text: string;
  stepped: boolean;
}

export interface PluginStatus {
  available: boolean;
  loaded: PluginInfo | null;
  bypass: boolean;
  hasGui: boolean;
  guiOpen: boolean;
  latencyMs: number;
  loadMs: number;
  /** Der Plugin-Prozess ist abgestürzt oder hing: die Meldung dazu. */
  crashed: string | null;
  /** Zuletzt geladenes Plugin, zum Neu-Laden nach einem Absturz. */
  last: PluginInfo | null;
}

interface PluginsState {
  status: PluginStatus;
  found: PluginInfo[];
  params: ParamDesc[];
  scanning: boolean;
  busy: boolean;
  error: string | null;
}

const EMPTY: PluginStatus = { available: false, loaded: null, bypass: false, hasGui: false, guiOpen: false, latencyMs: 0, loadMs: 0, crashed: null, last: null };

let state: PluginsState = { status: EMPTY, found: [], params: [], scanning: false, busy: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PluginsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function usePlugins<T>(selector: (s: PluginsState) => T): T {
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

/* ---------- Vorschau ohne Tauri ---------- */

const DEMO_FOUND: PluginInfo[] = [
  { path: "C:\\Program Files\\Common Files\\CLAP\\Surge XT Effects.clap", id: "org.surge-synth-team.surge-xt-fx", name: "Surge XT Effects", vendor: "Surge Synth Team", version: "1.3.4" },
  { path: "C:\\Program Files\\Common Files\\CLAP\\Airwindows Consolidated.clap", id: "com.airwindows.consolidated", name: "Airwindows Consolidated", vendor: "Airwindows", version: "2.0" },
];

const DEMO_PARAMS: ParamDesc[] = ["Mix", "Drive", "Tone", "Room", "Width", "Output", "Attack", "Release", "Mode"].map((name, i) => ({
  id: i + 1,
  name,
  module: i < 3 ? "Main" : "Space",
  min: 0,
  max: name === "Mode" ? 3 : 1,
  default: 0.5,
  value: name === "Mode" ? 1 : 0.2 + (i % 5) * 0.15,
  text: "",
  stepped: name === "Mode",
}));

const demo = {
  status: { ...EMPTY, available: true } as PluginStatus,
  params: DEMO_PARAMS,
};

async function call<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: () => T): Promise<T> {
  if (!isTauri) return fallback();
  return invoke<T>(cmd, args);
}

export const plugins = {
  async refresh() {
    const status = await call<PluginStatus>("plugins_status", undefined, () => demo.status);
    set({ status });
    if (status.loaded) await plugins.loadParams();
    else set({ params: [] });
  },

  async scan() {
    set({ scanning: true, error: null });
    try {
      const found = await call<PluginInfo[]>("plugins_scan", undefined, () => DEMO_FOUND);
      set({ found });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ scanning: false });
    }
  },

  /** Eine .clap-Datei von woanders auswählen. */
  async pickFile() {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "CLAP", extensions: ["clap"] }] });
    if (typeof path !== "string") return;
    try {
      const entries = await invoke<PluginInfo[]>("plugins_entries", { path });
      const found = [...state.found.filter((f) => f.path !== path), ...entries];
      set({ found, error: entries.length ? null : t("plugins.emptyFile") });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  async load(info: PluginInfo) {
    set({ busy: true, error: null });
    try {
      const status = await call<PluginStatus>("plugin_load", { path: info.path, id: info.id }, () => {
        demo.status = { ...demo.status, loaded: info, hasGui: true, latencyMs: 0, loadMs: 0.12 };
        return demo.status;
      });
      set({ status });
      await plugins.loadParams();
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  async unload() {
    const status = await call<PluginStatus>("plugin_unload", undefined, () => {
      demo.status = { ...demo.status, loaded: null, guiOpen: false };
      return demo.status;
    });
    set({ status, params: [] });
  },

  async loadParams() {
    try {
      const params = await call<ParamDesc[]>("plugin_params", undefined, () => demo.params);
      set({ params });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  /** Sofort in der Anzeige, die Engine bekommt den Wert als Event. */
  setParam(id: number, value: number) {
    set({ params: state.params.map((p) => (p.id === id ? { ...p, value, text: "" } : p)) });
    if (isTauri) void invoke("plugin_set_param", { id, value }).catch((e) => set({ error: message(e) }));
    else demo.params = state.params;
  },

  async setBypass(on: boolean) {
    const status = await call<PluginStatus>("plugin_bypass", { on }, () => (demo.status = { ...demo.status, bypass: on }));
    set({ status });
  },

  async gui(open: boolean) {
    try {
      const status = await call<PluginStatus>("plugin_gui", { open }, () => (demo.status = { ...demo.status, guiOpen: open }));
      set({ status, error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  /** Nach einem Absturz dasselbe Plugin wieder einsetzen. */
  async reload() {
    const last = state.status.last;
    if (last) await plugins.load(last);
  },

  dismissError() {
    set({ error: null });
  },
};
