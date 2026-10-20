import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ChannelId = "mic" | "soundboard" | "music" | "live";
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

export interface DuckingParams {
  enabled: boolean;
  /** Absenkung von Soundboard und Musik in dB. */
  amountDb: number;
  /** Ab diesem Mikrofonpegel (dBFS) gilt: es wird gesprochen. */
  thresholdDb: number;
}

export type Scale = "chromatic" | "major" | "minor" | "pentatonic" | "blues";
export type CharacterMode = "robot" | "radio" | "telephone" | "megaphone" | "distortion" | "bitcrusher" | "lofi";
export type ModulationMode = "chorus" | "flanger" | "phaser";
export type Chord = "single" | "fifth" | "major" | "minor";

export interface ReverbParams {
  enabled: boolean;
  /** Raumgröße 0–1. */
  size: number;
  /** Höhendämpfung 0–1. */
  damping: number;
  predelayMs: number;
  lowCutHz: number;
  /** Anteil 0–1; auf dem Bus die Rückführung. */
  mix: number;
}

export interface EchoParams {
  enabled: boolean;
  timeMs: number;
  /** 0–0,95. */
  feedback: number;
  toneHz: number;
  /** Anteil 0–1; auf dem Bus die Rückführung. */
  mix: number;
}

export interface HarmonyVoice {
  enabled: boolean;
  semitones: number;
  level: number;
}

/** Stimm-Effekte; Presets speichern genau diesen Teil. */
export interface VoiceParams {
  /** Hauptschalter aller Stimm-Effekte. */
  enabled: boolean;
  pitch: { enabled: boolean; semitones: number; formant: number };
  /** key: 0 = C … 11 = H; speed: 0 = sofort, 1 = langsam. */
  autotune: { enabled: boolean; key: number; scale: Scale; speed: number };
  harmonizer: { enabled: boolean; voices: [HarmonyVoice, HarmonyVoice] };
  /** note: Midi-Note des Trägers; follow: Träger folgt der Stimme. */
  vocoder: { enabled: boolean; note: number; follow: boolean; chord: Chord; breath: number; mix: number };
  /** amount und tone 0–1, ihre Bedeutung hängt vom Modus ab. */
  character: { enabled: boolean; mode: CharacterMode; amount: number; tone: number; mix: number };
  modulation: { enabled: boolean; mode: ModulationMode; rateHz: number; depth: number; feedback: number; mix: number };
  echo: EchoParams;
  reverb: ReverbParams;
}

export interface EffectsParams {
  gate: { enabled: boolean; thresholdDb: number };
  /** voiceGate: senkt alles ab, was RNNoise nicht als Sprache erkennt (Klicks, Tippen). */
  denoise: { enabled: boolean; voiceGate: boolean; strength: number };
  eq: { enabled: boolean; lowDb: number; midDb: number; highDb: number };
  /** Automatische Lautstärke: Ziel −30…−10 dBFS, Anhebung höchstens 0…30 dB. */
  agc: { enabled: boolean; targetDb: number; maxGainDb: number };
  compressor: { enabled: boolean; thresholdDb: number; ratio: number; makeupDb: number };
  deEsser: { enabled: boolean; thresholdDb: number; frequencyHz: number };
  exciter: { enabled: boolean; frequencyHz: number; amount: number };
  limiter: { enabled: boolean; ceilingDb: number };
  voice: VoiceParams;
}

/** Klang-EQ und Sends eines Kanals im Pult. */
export interface ChannelFx {
  eqEnabled: boolean;
  lowDb: number;
  midDb: number;
  highDb: number;
  /** 20 = aus. */
  lowCutHz: number;
  /** 20000 = aus. */
  highCutHz: number;
  reverbSend: number;
  echoSend: number;
}

export interface BusParams {
  reverb: ReverbParams;
  echo: EchoParams;
  channels: Record<ChannelId, ChannelFx>;
}

export interface MixerState {
  channels: [ChannelId, ChannelParams][];
  outA: OutputParams;
  outB: OutputParams;
  ducking: DuckingParams;
  effects: EffectsParams;
  buses: BusParams;
}

export interface Preset {
  id: string;
  /** Leer bei mitgelieferten Presets: dann gilt der übersetzte Name. */
  name: string;
  icon: string;
  /** Farbe der Taste, Name aus SOUND_COLORS. */
  color: string;
  hotkey: string | null;
  hotkeyLabel: string | null;
  builtin: boolean;
  voice: VoiceParams;
}

export interface PresetState {
  presets: Preset[];
  active: string | null;
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
  /** Aktuelle Absenkung durch Ducking in dB, 0 = keine. */
  duckingDb: number;
  effects: {
    gateOpen: boolean;
    voice: number;
    /** Sprach-Gate lässt gerade durch. */
    voiceOpen: boolean;
    /** Aktuelle Verstärkung der AGC in dB. */
    agcGainDb: number;
    compressorDb: number;
    deEsserDb: number;
    limiterDb: number;
    /** Erkannte Tonhöhe in Hz, 0 = keine. */
    pitchHz: number;
    /** Zielnote des Autotune (Midi), −1 = keine. */
    targetNote: number;
    correctionCents: number;
    /** Zusätzliche Verzögerung der Stimm-Effekte in ms. */
    voiceLatencyMs: number;
    /** 16 Bandpegel des Vocoders. */
    vocoder: number[];
  };
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
  setDucking: (params: DuckingParams) => invoke<void>("set_ducking", { params }),
  setEffects: (params: EffectsParams) => invoke<void>("set_effects", { params }),
  setBuses: (params: BusParams) => invoke<void>("set_buses", { params }),
  onMeters: (handler: (meters: Meters) => void): Promise<UnlistenFn> =>
    listen<Meters>("engine://meters", (event) => handler(event.payload)),
  /** Preset per Hotkey gewechselt: neue Effekte und aktives Preset. */
  onVoiceChanged: (handler: (change: { effects: EffectsParams; active: string | null }) => void): Promise<UnlistenFn> =>
    listen<{ effects: EffectsParams; active: string | null }>("effects://changed", (event) => handler(event.payload)),
  presetsState: () => invoke<PresetState>("presets_state"),
  presetApply: (id: string) => invoke<void>("preset_apply", { id }),
  presetOff: () => invoke<void>("preset_off"),
  presetSave: (preset: Preset) =>
    invoke<{ state: PresetState; hotkeyErrors: string[] }>("preset_save", { preset }),
  presetDelete: (id: string) => invoke<PresetState>("preset_delete", { id }),
  presetsReorder: (ids: string[]) => invoke<PresetState>("presets_reorder", { ids }),
  presetsRestore: () => invoke<PresetState>("presets_restore"),
};
