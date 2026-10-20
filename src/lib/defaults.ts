import type { BusParams, ChannelFx, EffectsParams, Preset, VoiceParams } from "./engine";

/* Auslieferungszustand, wie in der Engine (src-tauri/src/audio/…). */

export const VOICE_DEFAULTS: VoiceParams = {
  enabled: true,
  pitch: { enabled: false, semitones: 0, formant: 0 },
  autotune: { enabled: false, key: 0, scale: "chromatic", speed: 0.3 },
  harmonizer: {
    enabled: false,
    voices: [
      { enabled: true, semitones: 4, level: 0.6 },
      { enabled: true, semitones: 7, level: 0.5 },
    ],
  },
  vocoder: { enabled: false, note: 48, follow: false, chord: "single", breath: 0.2, mix: 1 },
  character: { enabled: false, mode: "robot", amount: 0.5, tone: 0.5, mix: 1 },
  modulation: { enabled: false, mode: "chorus", rateHz: 0.8, depth: 0.5, feedback: 0.3, mix: 0.5 },
  echo: { enabled: false, timeMs: 320, feedback: 0.35, toneHz: 4000, mix: 0.3 },
  reverb: { enabled: false, size: 0.6, damping: 0.5, predelayMs: 20, lowCutHz: 200, mix: 0.25 },
};

export const EFFECTS_DEFAULTS: EffectsParams = {
  gate: { enabled: false, thresholdDb: -50 },
  denoise: { enabled: false, voiceGate: true },
  eq: { enabled: false, lowDb: 0, midDb: 0, highDb: 0 },
  agc: { enabled: false, targetDb: -20, maxGainDb: 18 },
  compressor: { enabled: false, thresholdDb: -20, ratio: 3, makeupDb: 4 },
  deEsser: { enabled: false, thresholdDb: -30, frequencyHz: 6000 },
  exciter: { enabled: false, frequencyHz: 3000, amount: 0.3 },
  limiter: { enabled: false, ceilingDb: -3 },
  voice: VOICE_DEFAULTS,
};

export const CHANNEL_FX_DEFAULTS: ChannelFx = {
  eqEnabled: false,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
  lowCutHz: 20,
  highCutHz: 20000,
  reverbSend: 0,
  echoSend: 0,
};

export const BUS_DEFAULTS: BusParams = {
  reverb: { enabled: true, size: 0.7, damping: 0.5, predelayMs: 25, lowCutHz: 250, mix: 0.8 },
  echo: { enabled: true, timeMs: 350, feedback: 0.35, toneHz: 3500, mix: 0.8 },
  channels: {
    mic: CHANNEL_FX_DEFAULTS,
    soundboard: CHANNEL_FX_DEFAULTS,
    music: CHANNEL_FX_DEFAULTS,
    live: CHANNEL_FX_DEFAULTS,
  },
};

const DEMO_COLORS: Record<string, string> = {
  helium: "cyan", giant: "amber", demon: "orange", robot: "blue", radio: "lime", phone: "emerald",
  megaphone: "orange", cave: "violet", cathedral: "violet", "hard-tune": "pink", "soft-tune": "pink",
  choir: "amber", vocoder: "blue", alien: "lime", ghost: "cyan", lofi: "amber",
};

function demo(id: string, icon: string, voice: Partial<VoiceParams>): Preset {
  return { id, name: "", icon, color: DEMO_COLORS[id] ?? "orange", hotkey: null, hotkeyLabel: null, builtin: true, voice: { ...VOICE_DEFAULTS, ...voice } };
}

const reverb = (size: number, mix: number) => ({ ...VOICE_DEFAULTS.reverb, enabled: true, size, mix });

/** Eine Auswahl der mitgelieferten Presets für die Vorschau ohne Engine. */
export const DEMO_PRESETS: Preset[] = [
  demo("helium", "balloon", { pitch: { enabled: true, semitones: 8, formant: 5 } }),
  demo("giant", "person", { pitch: { enabled: true, semitones: -5, formant: -4 }, reverb: reverb(0.5, 0.15) }),
  demo("demon", "skull", { pitch: { enabled: true, semitones: -9, formant: -3 }, reverb: reverb(0.7, 0.25) }),
  demo("robot", "robot", { character: { enabled: true, mode: "robot", amount: 0.85, tone: 0.25, mix: 1 } }),
  demo("radio", "radio", { character: { enabled: true, mode: "radio", amount: 0.5, tone: 0.4, mix: 1 } }),
  demo("phone", "phone", { character: { enabled: true, mode: "telephone", amount: 0.4, tone: 0.2, mix: 1 } }),
  demo("megaphone", "megaphone", { character: { enabled: true, mode: "megaphone", amount: 0.6, tone: 0.6, mix: 1 } }),
  demo("cave", "mountains", { reverb: reverb(0.92, 0.45) }),
  demo("cathedral", "church", { reverb: reverb(1, 0.55) }),
  demo("hard-tune", "music-notes", { autotune: { enabled: true, key: 0, scale: "chromatic", speed: 0 } }),
  demo("soft-tune", "music-note", { autotune: { enabled: true, key: 0, scale: "chromatic", speed: 0.55 } }),
  demo("choir", "users-three", { harmonizer: { ...VOICE_DEFAULTS.harmonizer, enabled: true }, reverb: reverb(0.75, 0.3) }),
  demo("vocoder", "piano-keys", { vocoder: { ...VOICE_DEFAULTS.vocoder, enabled: true, follow: true, chord: "fifth" } }),
  demo("alien", "alien", { pitch: { enabled: true, semitones: 3, formant: 6 } }),
  demo("ghost", "ghost", { pitch: { enabled: true, semitones: -2, formant: 0 }, reverb: reverb(0.95, 0.6) }),
  demo("lofi", "cassette-tape", { character: { enabled: true, mode: "lofi", amount: 0.6, tone: 0.35, mix: 1 } }),
];
