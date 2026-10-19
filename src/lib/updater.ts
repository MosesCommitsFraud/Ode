import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";

/*
 * Updates kommen aus den GitHub-Releases (latest.json, signiert). Beim Start
 * wird einmal still geprüft; in den Einstellungen gibt es den Knopf dafür.
 */

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  version: string | null;
  status: UpdateStatus;
  /** Version und Notizen des gefundenen Updates. */
  available: { version: string; notes: string | null; date: string | null } | null;
  /** Fortschritt 0–1 beim Herunterladen; null, wenn die Größe unbekannt ist. */
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
}

let state: UpdaterState = {
  version: null,
  status: "idle",
  available: null,
  progress: null,
  error: null,
  checkedAt: null,
};
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<UpdaterState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useUpdater<T>(selector: (s: UpdaterState) => T): T {
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

let initialized = false;

export const updater = {
  /** Version lesen und einmal im Hintergrund nach Updates sehen. */
  async init() {
    if (initialized) return;
    initialized = true;
    if (!isTauri) {
      set({ version: "0.1.0" });
      return;
    }
    set({ version: await getVersion().catch(() => null) });
    await updater.check({ silent: true });
  },

  /** Fragt GitHub nach einer neueren Version. Still: Fehler nicht anzeigen. */
  async check({ silent = false }: { silent?: boolean } = {}) {
    if (state.status === "checking" || state.status === "downloading") return;
    if (!isTauri) {
      set({ status: "checking", error: null });
      await new Promise((r) => setTimeout(r, 600));
      set({ status: "current", checkedAt: Date.now() });
      return;
    }
    set({ status: "checking", error: null });
    try {
      pending = await check();
      if (pending) {
        set({
          status: "available",
          available: { version: pending.version, notes: pending.body ?? null, date: pending.date ?? null },
          checkedAt: Date.now(),
        });
      } else {
        set({ status: "current", available: null, checkedAt: Date.now() });
      }
    } catch (e) {
      set({ status: silent ? "idle" : "error", error: silent ? null : message(e), checkedAt: Date.now() });
    }
  },

  /** Lädt das gefundene Update, installiert es und startet Ode neu. */
  async install() {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ status: "downloading", progress: null, error: null });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          set({ progress: total > 0 ? Math.min(1, received / total) : null });
        } else if (event.event === "Finished") {
          set({ status: "ready", progress: 1 });
        }
      });
      set({ status: "ready" });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: message(e) });
    }
  },
};
