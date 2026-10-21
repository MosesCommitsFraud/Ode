import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";
import { library } from "./library";
import { music } from "./music";

export type Target = "soundboard" | "music" | "both";
export type JobStatus = "queued" | "info" | "downloading" | "converting" | "importing" | "done" | "failed" | "cancelled";

export interface Job {
  id: number;
  url: string;
  target: Target;
  status: JobStatus;
  progress: number;
  title: string | null;
  artist: string | null;
  error: string | null;
  /** Absoluter Pfad zum Cover; in der Oberfläche mit convertFileSrc laden. */
  cover: string | null;
  soundId: number | null;
  trackId: number | null;
}

export interface ToolsStatus {
  ytDlp: string | null;
  ffmpeg: boolean;
  installing: boolean;
  step: string | null;
  progress: number;
  error: string | null;
}

interface DownloadsState {
  tools: ToolsStatus;
  jobs: Job[];
  error: string | null;
}

let state: DownloadsState = {
  tools: { ytDlp: null, ffmpeg: false, installing: false, step: null, progress: 0, error: null },
  jobs: [],
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<DownloadsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useDownloads<T>(selector: (s: DownloadsState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export const ACTIVE: JobStatus[] = ["queued", "info", "downloading", "converting", "importing"];

let initialized = false;

export const downloads = {
  async init() {
    if (initialized) return;
    initialized = true;
    if (!isTauri) return startDemo();
    await listen<ToolsStatus>("tools://status", (e) => set({ tools: e.payload }));
    await listen<Job[]>("downloads://jobs", (e) => set({ jobs: e.payload }));
    // Fertige Downloads landen in der Bibliothek: dort neu laden.
    await listen<Target>("library://changed", (e) => {
      if (e.payload !== "music") void library.load();
      if (e.payload !== "soundboard") void music.reload();
    });
    const [tools, jobs] = await Promise.all([
      invoke<ToolsStatus>("tools_status"),
      invoke<Job[]>("downloads_list"),
    ]);
    set({ tools, jobs });
  },

  async installTools() {
    if (!isTauri) return;
    set({ tools: { ...state.tools, installing: true, error: null } });
    await invoke("tools_install");
  },

  async add(url: string, target: Target) {
    set({ error: null });
    if (!isTauri) return demoAdd(url, target);
    try {
      await invoke("download_add", { url, target });
    } catch (e) {
      set({ error: typeof e === "string" ? e : String(e) });
    }
  },

  /** Ziel eines fertigen Downloads ändern (übernimmt bzw. entfernt in den Bibliotheken). */
  async setTarget(id: number, target: Target) {
    set({ error: null, jobs: state.jobs.map((j) => (j.id === id ? { ...j, target } : j)) });
    if (!isTauri) return;
    try {
      await invoke("download_set_target", { id, target });
    } catch (e) {
      set({ error: typeof e === "string" ? e : String(e) });
    }
  },

  async cancel(id: number) {
    if (!isTauri) return set({ jobs: state.jobs.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)) });
    await invoke("download_cancel", { id });
  },

  /** Öffnet den Ordner mit den fertigen MP3s im Explorer. */
  async openFolder() {
    if (!isTauri) return;
    try {
      await invoke("downloads_open_folder");
    } catch (e) {
      set({ error: typeof e === "string" ? e : String(e) });
    }
  },

  async clearFinished() {
    if (!isTauri) return set({ jobs: state.jobs.filter((j) => ACTIVE.includes(j.status)) });
    await invoke("downloads_clear");
  },
};

// ---------------------------------------------------------------- Demo

function startDemo() {
  set({
    tools: { ytDlp: "2026.08.19", ffmpeg: true, installing: false, step: null, progress: 0, error: null },
    jobs: [
      { id: 1, url: "https://youtu.be/demo1", target: "music", status: "done", progress: 1, title: "Nightdrive", artist: "Synthwave Club", error: null, cover: null, soundId: null, trackId: 2 },
      { id: 2, url: "https://youtu.be/demo2", target: "soundboard", status: "failed", progress: 0, title: null, artist: null, error: "Video nicht verfügbar", cover: null, soundId: null, trackId: null },
    ],
  });
}

let demoId = 10;

function demoAdd(url: string, target: Target) {
  const id = ++demoId;
  const job: Job = { id, url, target, status: "queued", progress: 0, title: null, artist: null, error: null, cover: null, soundId: null, trackId: null };
  set({ jobs: [...state.jobs, job] });
  const steps: [JobStatus, number][] = [
    ["info", 600],
    ["downloading", 2500],
    ["converting", 1200],
    ["importing", 400],
    ["done", 0],
  ];
  let elapsed = 0;
  for (const [status, ms] of steps) {
    const start = elapsed;
    setTimeout(() => {
      const t = Date.now();
      const tick = setInterval(() => {
        const progress = ms ? Math.min(1, (Date.now() - t) / ms) : 1;
        set({
          jobs: state.jobs.map((j) =>
            j.id === id && j.status !== "cancelled"
              ? { ...j, status, progress, title: status === "info" ? null : "Demo-Titel" }
              : j,
          ),
        });
        if (progress >= 1) clearInterval(tick);
      }, 100);
    }, start);
    elapsed += ms;
  }
}
