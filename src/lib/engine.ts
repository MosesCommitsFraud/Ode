import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ChannelId = "mic" | "soundboard" | "music";
export type OutputId = "a" | "b";

export interface DeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
  isVirtualCable: boolean;
}

export interface DeviceList {
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
}

export interface EngineConfig {
  inputId: string;
  monitorId: string | null;
  cableId: string | null;
  bufferMs: number;
}

export interface StreamInfo {
  deviceName: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
}

export interface EngineInfo {
  input: StreamInfo;
  monitor: StreamInfo | null;
  cable: StreamInfo | null;
}

export interface ChannelParams {
  gainDb: number;
  muted: boolean;
  routeA: boolean;
  routeB: boolean;
}

export interface OutputParams {
  gainDb: number;
  muted: boolean;
  limiter: boolean;
}

export interface MixerState {
  channels: [ChannelId, ChannelParams][];
  outA: OutputParams;
  outB: OutputParams;
}

export interface OutputMeters {
  peak: number;
  gainReductionDb: number;
  bufferedMs: number;
  callbackMs: number;
  underruns: number;
  overruns: number;
}

export interface Meters {
  running: boolean;
  channels: { id: ChannelId; peak: number }[];
  outA: OutputMeters;
  outB: OutputMeters;
  inputCallbackMs: number;
  latencyMs: number;
  errors: string[];
  /** Laufende Soundboard-Sounds mit Fortschritt 0–1. */
  playing: { id: number; progress: number }[];
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const engine = {
  listDevices: () => invoke<DeviceList>("list_devices"),
  start: (config: EngineConfig) => invoke<EngineInfo>("start_engine", { config }),
  stop: () => invoke<void>("stop_engine"),
  info: () => invoke<EngineInfo | null>("engine_info"),
  getMixer: () => invoke<MixerState>("get_mixer"),
  setChannel: (channel: ChannelId, params: ChannelParams) =>
    invoke<void>("set_channel", { channel, params }),
  setOutput: (output: OutputId, params: OutputParams) =>
    invoke<void>("set_output", { output, params }),
  onMeters: (handler: (meters: Meters) => void): Promise<UnlistenFn> =>
    listen<Meters>("engine://meters", (event) => handler(event.payload)),
};
