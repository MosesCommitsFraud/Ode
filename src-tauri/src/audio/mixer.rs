//! Mischpult-Zustand, den Audio-Threads und Steuerung lock-frei teilen.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::dsp::{AtomicF32, db_to_gain};
use super::effects::{EffectsParams, EffectsShared};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelId {
    Mic,
    Soundboard,
    Music,
}

impl ChannelId {
    pub const ALL: [ChannelId; 3] = [ChannelId::Mic, ChannelId::Soundboard, ChannelId::Music];

    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputId {
    /// Kopfhörer zum Mithören.
    A,
    /// Virtuelles Mikrofon.
    B,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelParams {
    pub gain_db: f32,
    pub muted: bool,
    pub route_a: bool,
    pub route_b: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputParams {
    pub gain_db: f32,
    pub muted: bool,
    pub limiter: bool,
}

#[derive(Debug)]
pub struct Channel {
    gain_db: AtomicF32,
    muted: AtomicBool,
    route_a: AtomicBool,
    route_b: AtomicBool,
    pub meter: AtomicF32,
}

impl Channel {
    fn new(params: ChannelParams) -> Self {
        Self {
            gain_db: AtomicF32::new(params.gain_db),
            muted: AtomicBool::new(params.muted),
            route_a: AtomicBool::new(params.route_a),
            route_b: AtomicBool::new(params.route_b),
            meter: AtomicF32::new(0.0),
        }
    }

    pub fn set(&self, params: ChannelParams) {
        self.gain_db.store(params.gain_db);
        self.muted.store(params.muted, Ordering::Relaxed);
        self.route_a.store(params.route_a, Ordering::Relaxed);
        self.route_b.store(params.route_b, Ordering::Relaxed);
    }

    pub fn params(&self) -> ChannelParams {
        ChannelParams {
            gain_db: self.gain_db.load(),
            muted: self.muted.load(Ordering::Relaxed),
            route_a: self.route_a.load(Ordering::Relaxed),
            route_b: self.route_b.load(Ordering::Relaxed),
        }
    }

    /// Lineare Verstärkung des Faders, 0 bei Mute.
    pub fn gain(&self) -> f32 {
        if self.muted.load(Ordering::Relaxed) {
            0.0
        } else {
            db_to_gain(self.gain_db.load())
        }
    }

    /// Anteil, der auf dem Ausgang landet (Routing), 0 oder 1.
    pub fn send(&self, output: OutputId) -> f32 {
        let routed = match output {
            OutputId::A => self.route_a.load(Ordering::Relaxed),
            OutputId::B => self.route_b.load(Ordering::Relaxed),
        };
        if routed { 1.0 } else { 0.0 }
    }
}

#[derive(Debug)]
pub struct Output {
    gain_db: AtomicF32,
    muted: AtomicBool,
    limiter: AtomicBool,
    pub meter: AtomicF32,
    pub gain_reduction_db: AtomicF32,
    /// Füllstand des Zwischenpuffers in Frames (Engine-Rate).
    pub buffered_frames: AtomicU32,
    /// Frames pro Geräte-Callback.
    pub callback_frames: AtomicU32,
    pub device_rate: AtomicU32,
    pub underruns: AtomicU64,
    pub overruns: AtomicU64,
}

impl Output {
    fn new(params: OutputParams) -> Self {
        Self {
            gain_db: AtomicF32::new(params.gain_db),
            muted: AtomicBool::new(params.muted),
            limiter: AtomicBool::new(params.limiter),
            meter: AtomicF32::new(0.0),
            gain_reduction_db: AtomicF32::new(0.0),
            buffered_frames: AtomicU32::new(0),
            callback_frames: AtomicU32::new(0),
            device_rate: AtomicU32::new(0),
            underruns: AtomicU64::new(0),
            overruns: AtomicU64::new(0),
        }
    }

    pub fn set(&self, params: OutputParams) {
        self.gain_db.store(params.gain_db);
        self.muted.store(params.muted, Ordering::Relaxed);
        self.limiter.store(params.limiter, Ordering::Relaxed);
    }

    pub fn params(&self) -> OutputParams {
        OutputParams {
            gain_db: self.gain_db.load(),
            muted: self.muted.load(Ordering::Relaxed),
            limiter: self.limiter.load(Ordering::Relaxed),
        }
    }

    pub fn gain(&self) -> f32 {
        if self.muted.load(Ordering::Relaxed) {
            0.0
        } else {
            db_to_gain(self.gain_db.load())
        }
    }

    /// Hat einen laufenden Geräte-Stream.
    pub fn is_active(&self) -> bool {
        self.device_rate.load(Ordering::Relaxed) != 0
    }

    pub fn limiter_enabled(&self) -> bool {
        self.limiter.load(Ordering::Relaxed)
    }

    pub fn reset_stats(&self) {
        self.buffered_frames.store(0, Ordering::Relaxed);
        self.callback_frames.store(0, Ordering::Relaxed);
        self.device_rate.store(0, Ordering::Relaxed);
        self.underruns.store(0, Ordering::Relaxed);
        self.overruns.store(0, Ordering::Relaxed);
        self.gain_reduction_db.store(0.0);
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingParams {
    pub enabled: bool,
    /// Um so viel werden Soundboard und Musik abgesenkt.
    pub amount_db: f32,
    /// Ab diesem Mikrofonpegel gilt: es wird gesprochen.
    pub threshold_db: f32,
}

#[derive(Debug)]
pub struct Ducking {
    enabled: AtomicBool,
    amount_db: AtomicF32,
    threshold_db: AtomicF32,
    /// Aktuelle Absenkung in dB, für die Anzeige.
    pub reduction_db: AtomicF32,
}

impl Ducking {
    fn new(params: DuckingParams) -> Self {
        Self {
            enabled: AtomicBool::new(params.enabled),
            amount_db: AtomicF32::new(params.amount_db),
            threshold_db: AtomicF32::new(params.threshold_db),
            reduction_db: AtomicF32::new(0.0),
        }
    }

    pub fn set(&self, params: DuckingParams) {
        self.enabled.store(params.enabled, Ordering::Relaxed);
        self.amount_db.store(params.amount_db.clamp(0.0, 40.0));
        self.threshold_db
            .store(params.threshold_db.clamp(-70.0, 0.0));
    }

    pub fn params(&self) -> DuckingParams {
        DuckingParams {
            enabled: self.enabled.load(Ordering::Relaxed),
            amount_db: self.amount_db.load(),
            threshold_db: self.threshold_db.load(),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Ziel-Verstärkung beim Sprechen (linear).
    pub fn reduction(&self) -> f32 {
        db_to_gain(-self.amount_db.load())
    }

    pub fn threshold(&self) -> f32 {
        db_to_gain(self.threshold_db.load())
    }
}

#[derive(Debug)]
pub struct Mixer {
    channels: [Channel; 3],
    pub ducking: Ducking,
    /// Effektkette des Mikrofons.
    pub effects: EffectsShared,
    /// Eigene Lautstärke des Players (0–1), vor dem Musik-Fader.
    pub player_volume: AtomicF32,
    pub out_a: Output,
    pub out_b: Output,
    pub input_callback_frames: AtomicU32,
    pub input_rate: AtomicU32,
    /// Längste Rechenzeit eines Eingangsblocks in µs seit dem letzten Auslesen.
    pub input_process_us: AtomicU32,
}

impl Default for Mixer {
    fn default() -> Self {
        let channel = |route_a| {
            Channel::new(ChannelParams {
                gain_db: 0.0,
                muted: false,
                route_a,
                route_b: true,
            })
        };
        Self {
            // Die eigene Stimme hört man standardmäßig nicht mit.
            channels: [channel(false), channel(true), channel(true)],
            effects: EffectsShared::default(),
            player_volume: AtomicF32::new(DEFAULT_PLAYER_VOLUME),
            ducking: Ducking::new(DuckingParams {
                enabled: false,
                amount_db: 12.0,
                threshold_db: -40.0,
            }),
            out_a: Output::new(OutputParams {
                gain_db: 0.0,
                muted: false,
                limiter: false,
            }),
            out_b: Output::new(OutputParams {
                gain_db: 0.0,
                muted: false,
                limiter: true,
            }),
            input_callback_frames: AtomicU32::new(0),
            input_rate: AtomicU32::new(0),
            input_process_us: AtomicU32::new(0),
        }
    }
}

/// Alle Mischpult-Einstellungen am Stück, zum Speichern und Laden.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixerSettings {
    pub channels: Vec<(ChannelId, ChannelParams)>,
    pub out_a: OutputParams,
    pub out_b: OutputParams,
    pub ducking: DuckingParams,
    #[serde(default)]
    pub effects: EffectsParams,
    #[serde(default = "default_player_volume")]
    pub player_volume: f32,
}

const DEFAULT_PLAYER_VOLUME: f32 = 0.8;

fn default_player_volume() -> f32 {
    DEFAULT_PLAYER_VOLUME
}

/// Regler 0–1 → Verstärkung, quadratisch, damit die Mitte natürlich klingt.
pub fn player_gain(volume: f32) -> f32 {
    let v = volume.clamp(0.0, 1.0);
    v * v
}

impl Mixer {
    pub fn settings(&self) -> MixerSettings {
        MixerSettings {
            channels: ChannelId::ALL
                .iter()
                .map(|&id| (id, self.channel(id).params()))
                .collect(),
            out_a: self.out_a.params(),
            out_b: self.out_b.params(),
            ducking: self.ducking.params(),
            effects: self.effects.params(),
            player_volume: self.player_volume.load(),
        }
    }

    pub fn apply(&self, settings: &MixerSettings) {
        for (id, params) in &settings.channels {
            self.channel(*id).set(*params);
        }
        self.out_a.set(settings.out_a);
        self.out_b.set(settings.out_b);
        self.ducking.set(settings.ducking);
        self.effects.set(settings.effects);
        self.player_volume
            .store(settings.player_volume.clamp(0.0, 1.0));
    }

    pub fn channel(&self, id: ChannelId) -> &Channel {
        &self.channels[id.index()]
    }

    pub fn output(&self, id: OutputId) -> &Output {
        match id {
            OutputId::A => &self.out_a,
            OutputId::B => &self.out_b,
        }
    }
}
