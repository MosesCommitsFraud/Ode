import { useSyncExternalStore } from "react";
import { t } from "./i18n";
import {
  engine,
  isTauri,
  type BusParams,
  type ChannelFx,
  type ChannelId,
  type ChannelParams,
  type DeviceList,
  type DuckingParams,
  type EffectsParams,
  type EngineConfig,
  type EngineInfo,
  type Meters,
  type OutputId,
  type OutputParams,
  type Preset,
  type VoiceParams,
} from "./engine";
import { BUS_DEFAULTS, DEMO_PRESETS, EFFECTS_DEFAULTS } from "./defaults";

export interface State {
  devices: DeviceList;
  config: EngineConfig;
  info: EngineInfo | null;
  channels: Record<ChannelId, ChannelParams>;
  outputs: Record<OutputId, OutputParams>;
  ducking: DuckingParams;
  effects: EffectsParams;
  buses: BusParams;
  presets: Preset[];
  /** Zuletzt gewähltes Preset, null = eigene Einstellung oder aus. */
  activePreset: string | null;
  /** Fehler beim Anmelden von Preset-Hotkeys. */
  presetErrors: string[];
  meters: Meters | null;
  starting: boolean;
  error: string | null;
}

const CONFIG_KEY = "ode.engine-config";

function loadConfig(): EngineConfig {
  const fallback: EngineConfig = { inputId: "", monitorId: null, cableId: null, bufferMs: 10 };
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    return fallback;
  }
}

const defaultChannel = (routeA: boolean): ChannelParams => ({
  gainDb: 0,
  muted: false,
  routeA,
  routeB: true,
});

let state: State = {
  devices: { inputs: [], outputs: [] },
  config: loadConfig(),
  info: null,
  channels: {
    mic: defaultChannel(false),
    soundboard: defaultChannel(true),
    music: defaultChannel(true),
    live: defaultChannel(true),
  },
  outputs: {
    a: { gainDb: 0, muted: false, limiter: false },
    b: { gainDb: 0, muted: false, limiter: true },
  },
  ducking: { enabled: false, amountDb: 12, thresholdDb: -40 },
  effects: EFFECTS_DEFAULTS,
  buses: BUS_DEFAULTS,
  presets: [],
  activePreset: null,
  presetErrors: [],
  meters: null,
  starting: false,
  error: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

function errorMessage(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/** Wählt sinnvolle Geräte, wenn noch nichts gespeichert ist. */
function withDefaults(config: EngineConfig, devices: DeviceList): EngineConfig {
  const has = (list: DeviceList["inputs"], id: string | null) => !!id && list.some((d) => d.id === id);
  const physicalInput = devices.inputs.find((d) => d.isDefault && !d.isVirtualCable) ??
    devices.inputs.find((d) => !d.isVirtualCable);
  // VB-Cable ist der Standard; "CABLE In 16ch" ist nur die Mehrkanal-Variante.
  const cable = devices.outputs.find((d) => d.name.startsWith("CABLE Input")) ??
    devices.outputs.find((d) => d.isVirtualCable);
  const monitor = devices.outputs.find((d) => d.isDefault && !d.isVirtualCable) ??
    devices.outputs.find((d) => !d.isVirtualCable);
  return {
    ...config,
    inputId: has(devices.inputs, config.inputId) ? config.inputId : (physicalInput?.id ?? ""),
    cableId: has(devices.outputs, config.cableId) ? config.cableId : (cable?.id ?? null),
    monitorId: has(devices.outputs, config.monitorId) ? config.monitorId : (monitor?.id ?? null),
  };
}

export const actions = {
  async init() {
    if (!isTauri) {
      startDemo();
      return;
    }
    await engine.onMeters((meters) => set({ meters }));
    await engine.onVoiceChanged(({ effects, active }) => set({ effects, activePreset: active }));
    const [mixer, info, presets] = await Promise.all([engine.getMixer(), engine.info(), engine.presetsState()]);
    set({
      info,
      channels: Object.fromEntries(mixer.channels) as State["channels"],
      outputs: { a: mixer.outA, b: mixer.outB },
      ducking: mixer.ducking,
      effects: mixer.effects,
      buses: mixer.buses,
      presets: presets.presets,
      activePreset: presets.active,
    });
    await actions.refreshDevices();
    // Ohne laufende Engine bleibt das Soundboard stumm – also gleich starten.
    const { config } = state;
    if (!state.info && config.inputId && (config.cableId || config.monitorId)) {
      await actions.start();
    }
  },

  async refreshDevices() {
    if (!isTauri) return;
    try {
      const devices = await engine.listDevices();
      set({ devices, config: withDefaults(state.config, devices) });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  setConfig(patch: Partial<EngineConfig>) {
    const config = { ...state.config, ...patch };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Speicher nicht verfügbar – Auswahl gilt dann nur für diese Sitzung.
    }
    set({ config });
    if (state.info) void actions.start();
  },

  async start() {
    if (!isTauri) return;
    if (!state.config.inputId) {
      set({ error: t("messages.noMicrophone") });
      return;
    }
    set({ starting: true, error: null });
    try {
      const info = await engine.start(state.config);
      set({ info, starting: false });
    } catch (e) {
      set({ info: null, starting: false, error: errorMessage(e) });
    }
  },

  async stop() {
    if (!isTauri) return;
    await engine.stop();
    set({ info: null });
  },

  setChannel(id: ChannelId, patch: Partial<ChannelParams>) {
    const params = { ...state.channels[id], ...patch };
    set({ channels: { ...state.channels, [id]: params } });
    if (isTauri) void engine.setChannel(id, params);
  },

  /** Ändert einen Effekt, z. B. setEffect("gate", { enabled: true }). */
  setEffect<K extends Exclude<keyof EffectsParams, "voice">>(key: K, patch: Partial<EffectsParams[K]>) {
    actions.setEffects({ ...state.effects, [key]: { ...state.effects[key], ...patch } });
  },

  /** Ändert einen Stimm-Effekt, z. B. setVoice("reverb", { mix: 0.4 }). */
  setVoice<K extends Exclude<keyof VoiceParams, "enabled">>(key: K, patch: Partial<VoiceParams[K]>) {
    const voice = { ...state.effects.voice, [key]: { ...state.effects.voice[key], ...patch } };
    actions.setEffects({ ...state.effects, voice });
  },

  /** Hauptschalter der Stimm-Effekte. */
  setVoiceEnabled(enabled: boolean) {
    actions.setEffects({ ...state.effects, voice: { ...state.effects.voice, enabled } });
  },

  setEffects(effects: EffectsParams) {
    set({ effects });
    if (isTauri) void engine.setEffects(effects);
  },

  setChannelFx(id: ChannelId, patch: Partial<ChannelFx>) {
    const channels = { ...state.buses.channels, [id]: { ...state.buses.channels[id], ...patch } };
    actions.setBuses({ ...state.buses, channels });
  },

  setBus<K extends "reverb" | "echo">(key: K, patch: Partial<BusParams[K]>) {
    actions.setBuses({ ...state.buses, [key]: { ...state.buses[key], ...patch } });
  },

  setBuses(buses: BusParams) {
    set({ buses });
    if (isTauri) void engine.setBuses(buses);
  },

  async applyPreset(id: string) {
    const preset = state.presets.find((p) => p.id === id);
    if (!preset) return;
    // Sofort zeigen; die Engine bestätigt über „effects://changed“.
    set({ effects: { ...state.effects, voice: { ...preset.voice, enabled: true } }, activePreset: id });
    if (isTauri) await engine.presetApply(id);
  },

  async presetOff() {
    set({ effects: { ...state.effects, voice: { ...state.effects.voice, enabled: false } }, activePreset: null });
    if (isTauri) await engine.presetOff();
  },

  async savePreset(preset: Preset) {
    if (!isTauri) {
      const exists = state.presets.some((p) => p.id === preset.id);
      set({ presets: exists ? state.presets.map((p) => (p.id === preset.id ? preset : p)) : [...state.presets, preset] });
      return;
    }
    const { state: next, hotkeyErrors } = await engine.presetSave(preset);
    set({ presets: next.presets, activePreset: next.active, presetErrors: hotkeyErrors });
  },

  async deletePreset(id: string) {
    if (!isTauri) {
      set({
        presets: state.presets.filter((p) => p.id !== id),
        activePreset: state.activePreset === id ? null : state.activePreset,
      });
      return;
    }
    const next = await engine.presetDelete(id);
    set({ presets: next.presets, activePreset: next.active });
  },

  async reorderPresets(ids: string[]) {
    const byId = new Map(state.presets.map((p) => [p.id, p]));
    set({ presets: ids.map((id) => byId.get(id)).filter((p): p is Preset => !!p) });
    if (isTauri) {
      const next = await engine.presetsReorder(ids);
      set({ presets: next.presets });
    }
  },

  async restorePresets() {
    if (!isTauri) {
      set({ presets: DEMO_PRESETS });
      return;
    }
    const next = await engine.presetsRestore();
    set({ presets: next.presets, activePreset: next.active });
  },

  dismissPresetErrors() {
    set({ presetErrors: [] });
  },

  setDucking(patch: Partial<DuckingParams>) {
    const ducking = { ...state.ducking, ...patch };
    set({ ducking });
    if (isTauri) void engine.setDucking(ducking);
  },

  /** Setzt alle Fader auf die Grundlautstärke 0 dB; Mute und Routing bleiben. */
  resetLevels() {
    for (const id of Object.keys(state.channels) as ChannelId[]) {
      if (state.channels[id].gainDb !== 0) actions.setChannel(id, { gainDb: 0 });
    }
    for (const id of Object.keys(state.outputs) as OutputId[]) {
      if (state.outputs[id].gainDb !== 0) actions.setOutput(id, { gainDb: 0 });
    }
  },

  setOutput(id: OutputId, patch: Partial<OutputParams>) {
    const params = { ...state.outputs[id], ...patch };
    set({ outputs: { ...state.outputs, [id]: params } });
    if (isTauri) void engine.setOutput(id, params);
  },
};

/** Im Demo-Modus gestartete Sounds: ID → Startzeit in Sekunden. */
export const demoStarts = new Map<number, number>();

function demoPlaying(t: number) {
  const playing: { id: number; progress: number }[] = [];
  for (const [id, start] of demoStarts) {
    const progress = (t - start) / 2.5;
    if (progress >= 1) demoStarts.delete(id);
    else playing.push({ id, progress });
  }
  return playing;
}

export function demoNow() {
  return demoClock;
}

let demoClock = 0;

/** Vorschau im Browser ohne Tauri: Beispielgeräte und simulierte Pegel. */
function startDemo() {
  const devices: DeviceList = {
    inputs: [
      { id: "demo:mic", name: "Mikrofon (Shure MV7)", isDefault: true, isVirtualCable: false },
      { id: "demo:cable-in", name: "CABLE Output (VB-Audio Virtual Cable)", isDefault: false, isVirtualCable: true },
    ],
    outputs: [
      { id: "demo:hp", name: "Kopfhörer (Realtek Audio)", isDefault: true, isVirtualCable: false },
      { id: "demo:cable", name: "CABLE Input (VB-Audio Virtual Cable)", isDefault: false, isVirtualCable: true },
    ],
  };
  const stream = (deviceName: string) => ({ deviceName, sampleRate: 48000, channels: 2, sampleFormat: "f32" });
  set({
    devices,
    presets: DEMO_PRESETS,
    config: withDefaults(state.config, devices),
    info: {
      input: stream(devices.inputs[0].name),
      monitor: stream(devices.outputs[0].name),
      cable: stream(devices.outputs[1].name),
    },
  });
  let t = 0;
  setInterval(() => {
    t += 0.033;
    demoClock = t;
    const voice = Math.max(0, Math.sin(t * 2.1) * 0.5 + Math.sin(t * 7.3) * 0.25) * 0.8;
    const output = (peak: number) => ({
      peak,
      gainReductionDb: peak > 0.89 ? -0.6 : 0,
      bufferedMs: 9.6 + Math.sin(t) * 0.4,
      callbackMs: 10,
      underruns: 0,
      overruns: 0,
    });
    set({
      meters: {
        running: true,
        channels: [
          { id: "mic", peak: voice },
          { id: "soundboard", peak: 0 },
          { id: "music", peak: 0 },
          { id: "live", peak: 0 },
        ],
        outA: output(0),
        outB: output(voice),
        inputCallbackMs: 10,
        latencyMs: 29.6 + Math.sin(t) * 0.4,
        errors: [],
        playing: demoPlaying(t),
        effects: {
          gateOpen: !state.effects.gate.enabled || voice > 0.05,
          voice: state.effects.denoise.enabled ? Math.min(1, voice * 2) : 0,
          voiceOpen: !state.effects.denoise.voiceGate || voice > 0.4,
          agcGainDb: state.effects.agc.enabled ? 6 + Math.sin(t * 0.3) * 2 : 0,
          compressorDb: state.effects.compressor.enabled ? -Math.max(0, voice * 12 - 3) : 0,
          deEsserDb: state.effects.deEsser.enabled ? -Math.max(0, Math.sin(t * 5.3) * 6) : 0,
          limiterDb: state.effects.limiter.enabled && voice > 0.6 ? -1.2 : 0,
          ...demoVoice(t, voice),
        },
        duckingDb: state.ducking.enabled && voice > 0.05 ? -state.ducking.amountDb : 0,
      },
    });
  }, 33);
}

/** Simulierte Anzeigen der Stimm-Effekte für die Vorschau im Browser. */
function demoVoice(t: number, level: number) {
  const v = state.effects.voice;
  const shifts = v.enabled && (v.pitch.enabled || v.autotune.enabled || v.harmonizer.enabled);
  const detects = shifts || (v.enabled && v.vocoder.enabled && v.vocoder.follow);
  const sung = 57.3 + Math.sin(t * 0.7) * 2.4 + Math.sin(t * 6) * 0.15;
  const voiced = detects && level > 0.15;
  const target = Math.round(sung);
  return {
    pitchHz: voiced ? 440 * Math.pow(2, (sung - 69) / 12) : 0,
    targetNote: voiced && v.autotune.enabled ? target : -1,
    correctionCents: voiced && v.autotune.enabled ? (target - sung) * 100 * (1 - v.autotune.speed * 0.6) : 0,
    voiceLatencyMs: shifts ? 40 : 0,
    vocoder: Array.from({ length: 16 }, (_, i) =>
      v.enabled && v.vocoder.enabled ? level * Math.max(0, 0.6 + 0.4 * Math.sin(t * 3 + i * 0.7)) * Math.exp(-i / 9) * 0.3 : 0,
    ),
  };
}
