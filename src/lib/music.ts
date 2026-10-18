import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { isTauri } from "./engine";
import { AUDIO_EXTENSIONS } from "./library";

export interface Track {
  id: number;
  title: string;
  artist: string | null;
  file: string;
  durationMs: number;
}

export interface Playlist {
  id: number;
  name: string;
  trackIds: number[];
}

export type Repeat = "off" | "all" | "one";

export interface PlayerState {
  track: Track | null;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  loading: boolean;
  shuffle: boolean;
  repeat: Repeat;
  queueLength: number;
  queueIndex: number;
  error: string | null;
}

/** `null` = alle Titel. */
export type PlaylistSelection = number | null;

interface MusicState {
  tracks: Track[];
  playlists: Playlist[];
  loaded: boolean;
  importing: number;
  notices: string[];
  selectedPlaylist: PlaylistSelection;
  player: PlayerState;
}

const emptyPlayer: PlayerState = {
  track: null,
  positionMs: 0,
  durationMs: 0,
  playing: false,
  loading: false,
  shuffle: false,
  repeat: "off",
  queueLength: 0,
  queueIndex: 0,
  error: null,
};

let state: MusicState = {
  tracks: [],
  playlists: [],
  loaded: false,
  importing: 0,
  notices: [],
  selectedPlaylist: null,
  player: emptyPlayer,
};
const listeners = new Set<() => void>();

function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useMusic<T>(selector: (s: MusicState) => T): T {
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

/** Titel der gewählten Playlist (oder alle) in Playlist-Reihenfolge. */
export function tracksOf(s: Pick<MusicState, "tracks" | "playlists">, playlist: PlaylistSelection): Track[] {
  if (playlist === null) return s.tracks;
  const byId = new Map(s.tracks.map((t) => [t.id, t]));
  return (s.playlists.find((p) => p.id === playlist)?.trackIds ?? [])
    .map((id) => byId.get(id))
    .filter((t): t is Track => !!t);
}

export function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function refresh() {
  const { tracks, playlists } = await invoke<{ tracks: Track[]; playlists: Playlist[] }>("music_state");
  set({ tracks, playlists, loaded: true });
}

let initialized = false;

export const music = {
  async init() {
    if (initialized) return;
    initialized = true;
    if (!isTauri) {
      startDemo();
      return;
    }
    await listen<PlayerState>("player://state", (e) => set({ player: e.payload }));
    await refresh().catch((e) => {
      set({ loaded: true });
      notify([message(e)]);
    });
  },

  /** Titel und Playlists neu laden, z. B. nach einem Download. */
  async reload() {
    if (isTauri) await refresh().catch((e) => notify([message(e)]));
  },

  selectPlaylist(selectedPlaylist: PlaylistSelection) {
    set({ selectedPlaylist });
  },

  async pickFiles() {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Musik hinzufügen",
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (picked) await music.importFiles(Array.isArray(picked) ? picked : [picked]);
  },

  /** Importiert Dateien; ist eine Playlist gewählt, landen sie auch dort. */
  async importFiles(paths: string[]) {
    const audio = paths.filter((p) => AUDIO_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? ""));
    if (audio.length < paths.length) {
      notify([`${paths.length - audio.length} Datei(en) übersprungen – kein unterstütztes Audioformat`]);
    }
    if (!isTauri || audio.length === 0) return;
    set({ importing: state.importing + audio.length });
    try {
      const result = await invoke<{ tracks: Track[]; errors: string[] }>("music_import", {
        paths: audio,
        playlistId: state.selectedPlaylist,
      });
      notify(result.errors);
      await refresh();
    } catch (e) {
      notify([message(e)]);
    } finally {
      set({ importing: Math.max(0, state.importing - audio.length) });
    }
  },

  async deleteTrack(id: number) {
    set({
      tracks: state.tracks.filter((t) => t.id !== id),
      playlists: state.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((t) => t !== id) })),
    });
    if (isTauri) await invoke("music_delete_track", { id }).catch((e) => notify([message(e)]));
  },

  async createPlaylist(name: string) {
    if (!isTauri) {
      const id = Math.max(0, ...state.playlists.map((p) => p.id)) + 1;
      set({ playlists: [...state.playlists, { id, name, trackIds: [] }], selectedPlaylist: id });
      return;
    }
    const id = await invoke<number>("playlist_create", { name });
    await refresh();
    set({ selectedPlaylist: id });
  },

  async renamePlaylist(id: number, name: string) {
    set({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, name } : p)) });
    if (isTauri) await invoke("playlist_rename", { id, name }).catch((e) => notify([message(e)]));
  },

  async deletePlaylist(id: number) {
    set({
      playlists: state.playlists.filter((p) => p.id !== id),
      selectedPlaylist: state.selectedPlaylist === id ? null : state.selectedPlaylist,
    });
    if (isTauri) await invoke("playlist_delete", { id }).catch((e) => notify([message(e)]));
  },

  async setPlaylistTracks(id: number, trackIds: number[]) {
    set({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, trackIds } : p)) });
    if (isTauri) await invoke("playlist_set_tracks", { id, trackIds }).catch((e) => notify([message(e)]));
  },

  async addToPlaylist(id: number, trackId: number) {
    const playlist = state.playlists.find((p) => p.id === id);
    if (playlist && !playlist.trackIds.includes(trackId)) {
      await music.setPlaylistTracks(id, [...playlist.trackIds, trackId]);
    }
  },

  /** Spielt eine Liste ab Index `start`; sie wird zur Warteschlange. */
  async play(queue: number[], start: number) {
    if (!isTauri) return demoPlay(queue, start);
    await invoke("player_play", { queue, start });
  },

  async toggle() {
    if (!isTauri) return demoToggle();
    await invoke("player_toggle");
  },

  async next() {
    if (!isTauri) return demoStep(1);
    await invoke("player_next");
  },

  async previous() {
    if (!isTauri) return demoStep(-1);
    await invoke("player_previous");
  },

  async seek(ms: number) {
    set({ player: { ...state.player, positionMs: ms } });
    if (!isTauri) return void (demo.position = ms);
    await invoke("player_seek", { ms: Math.round(ms) });
  },

  async setShuffle(shuffle: boolean) {
    set({ player: { ...state.player, shuffle } });
    if (isTauri) await invoke("player_set_shuffle", { shuffle });
  },

  async setRepeat(repeat: Repeat) {
    set({ player: { ...state.player, repeat } });
    if (isTauri) await invoke("player_set_repeat", { repeat });
  },

  dismissNotice(index: number) {
    set({ notices: state.notices.filter((_, i) => i !== index) });
  },
};

// ---------------------------------------------------------------- Demo

const demo = { queue: [] as number[], index: 0, position: 0, playing: false };

function demoTrack() {
  return state.tracks.find((t) => t.id === demo.queue[demo.index]) ?? null;
}

function demoPublish() {
  const track = demoTrack();
  set({
    player: {
      ...state.player,
      track,
      positionMs: demo.position,
      durationMs: track?.durationMs ?? 0,
      playing: demo.playing,
      queueLength: demo.queue.length,
      queueIndex: demo.index,
    },
  });
}

function demoPlay(queue: number[], start: number) {
  Object.assign(demo, { queue, index: start, position: 0, playing: true });
  demoPublish();
}

function demoToggle() {
  if (!demoTrack()) return;
  demo.playing = !demo.playing;
  demoPublish();
}

function demoStep(delta: number) {
  if (demo.queue.length === 0) return;
  demo.index = (demo.index + delta + demo.queue.length) % demo.queue.length;
  demo.position = 0;
  demoPublish();
}

function startDemo() {
  const songs: [string, string | null, number][] = [
    ["Lofi Morning", "Chillhop Kollektiv", 184_000],
    ["Nightdrive", "Synthwave Club", 241_000],
    ["Coffee Break", null, 132_000],
    ["Boss Fight Theme", "8-Bit Orchester", 205_000],
    ["Rainy Window", "Chillhop Kollektiv", 198_000],
    ["Victory Lap", "8-Bit Orchester", 96_000],
  ];
  set({
    tracks: songs.map(([title, artist, durationMs], i) => ({ id: i + 1, title, artist, file: "", durationMs })),
    playlists: [
      { id: 1, name: "Chill beim Zocken", trackIds: [1, 3, 5] },
      { id: 2, name: "Hype", trackIds: [2, 4, 6] },
    ],
    loaded: true,
  });
  setInterval(() => {
    const track = demoTrack();
    if (!demo.playing || !track) return;
    demo.position += 250;
    if (demo.position >= track.durationMs) demoStep(1);
    demoPublish();
  }, 250);
}
