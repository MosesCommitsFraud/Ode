//! Mikrofon-Effektkette in fester Reihenfolge: Noise Gate → Rauschunterdrückung
//! (RNNoise mit Sprach-Gate) → Equalizer → automatische Lautstärke (AGC) →
//! Kompressor → Limiter. Jeder Effekt ist einzeln
//! schaltbar. Die Kette läuft im Eingangs-Callback in Engine-Rate.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use nnnoiseless::DenoiseState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::ENGINE_RATE;
use super::dsp::{AtomicF32, Biquad, Limiter, Shape, coef, db_to_gain, to_db};

const RATE: f32 = ENGINE_RATE as f32;

// ------------------------------------------------------------ Parameter

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GateParams {
    pub enabled: bool,
    /// Darunter wird stummgeschaltet.
    pub threshold_db: f32,
}

impl Default for GateParams {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_db: -50.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DenoiseParams {
    pub enabled: bool,
    /// Senkt alles ab, was RNNoise nicht als Sprache erkennt (Klicks, Tippen
    /// zwischen den Wörtern).
    pub voice_gate: bool,
}

impl Default for DenoiseParams {
    fn default() -> Self {
        Self {
            enabled: false,
            voice_gate: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgcParams {
    pub enabled: bool,
    /// Ziel-Lautheit der Sprache (RMS in dBFS).
    pub target_db: f32,
    /// Höchstens so viel wird angehoben.
    pub max_gain_db: f32,
}

impl Default for AgcParams {
    fn default() -> Self {
        Self {
            enabled: false,
            target_db: -20.0,
            max_gain_db: 18.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqParams {
    pub enabled: bool,
    /// Tiefen-Kuhschwanz bei 120 Hz.
    pub low_db: f32,
    /// Präsenz-Glocke bei 2,5 kHz.
    pub mid_db: f32,
    /// Höhen-Kuhschwanz bei 8 kHz.
    pub high_db: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompressorParams {
    pub enabled: bool,
    pub threshold_db: f32,
    pub ratio: f32,
    pub makeup_db: f32,
}

impl Default for CompressorParams {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_db: -20.0,
            ratio: 3.0,
            makeup_db: 4.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LimiterParams {
    pub enabled: bool,
    pub ceiling_db: f32,
}

impl Default for LimiterParams {
    fn default() -> Self {
        Self {
            enabled: false,
            ceiling_db: -3.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EffectsParams {
    pub gate: GateParams,
    pub denoise: DenoiseParams,
    pub eq: EqParams,
    pub agc: AgcParams,
    pub compressor: CompressorParams,
    pub limiter: LimiterParams,
}

impl EffectsParams {
    fn clamped(mut self) -> Self {
        self.gate.threshold_db = self.gate.threshold_db.clamp(-80.0, -10.0);
        for db in [
            &mut self.eq.low_db,
            &mut self.eq.mid_db,
            &mut self.eq.high_db,
        ] {
            *db = db.clamp(-12.0, 12.0);
        }
        self.agc.target_db = self.agc.target_db.clamp(-30.0, -10.0);
        self.agc.max_gain_db = self.agc.max_gain_db.clamp(0.0, 30.0);
        self.compressor.threshold_db = self.compressor.threshold_db.clamp(-50.0, 0.0);
        self.compressor.ratio = self.compressor.ratio.clamp(1.0, 20.0);
        self.compressor.makeup_db = self.compressor.makeup_db.clamp(0.0, 24.0);
        self.limiter.ceiling_db = self.limiter.ceiling_db.clamp(-20.0, 0.0);
        self
    }
}

/// Zwischen Steuerung und Audio-Thread geteilt.
#[derive(Debug, Default)]
pub struct EffectsShared {
    params: Mutex<EffectsParams>,
    version: AtomicU64,
    pub gate_open: AtomicBool,
    /// Sprachwahrscheinlichkeit laut RNNoise, 0–1.
    pub voice: AtomicF32,
    /// Sprach-Gate lässt gerade durch.
    pub voice_open: AtomicBool,
    /// Aktuelle Verstärkung der AGC in dB.
    pub agc_gain_db: AtomicF32,
    pub compressor_reduction_db: AtomicF32,
    pub limiter_reduction_db: AtomicF32,
}

impl EffectsShared {
    pub fn set(&self, params: EffectsParams) {
        *self.params.lock() = params.clamped();
        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn params(&self) -> EffectsParams {
        *self.params.lock()
    }
}

// ------------------------------------------------------------ Bausteine

struct Gate {
    envelope: f32,
    hold: usize,
    gain: f32,
    env_release: f32,
    open: f32,
    close: f32,
}

impl Gate {
    fn new() -> Self {
        Self {
            envelope: 0.0,
            hold: 0,
            gain: 1.0,
            env_release: coef(40.0),
            open: coef(1.5),
            close: coef(80.0),
        }
    }

    fn process(&mut self, buf: &mut [f32], threshold: f32) -> bool {
        let hold_samples = (0.15 * RATE) as usize;
        let closed = db_to_gain(-70.0);
        for s in buf.iter_mut() {
            self.envelope = s.abs().max(self.envelope * self.env_release);
            if self.envelope > threshold {
                self.hold = hold_samples;
            } else {
                self.hold = self.hold.saturating_sub(1);
            }
            let target = if self.hold > 0 { 1.0 } else { closed };
            let c = if target > self.gain {
                self.open
            } else {
                self.close
            };
            self.gain = target + (self.gain - target) * c;
            *s *= self.gain;
        }
        self.hold > 0
    }
}

/// RNNoise arbeitet in festen 10-ms-Rahmen; das verzögert um genau einen Rahmen.
struct Denoiser {
    state: Box<DenoiseState<'static>>,
    input: VecDeque<f32>,
    output: VecDeque<f32>,
    frame_in: [f32; DenoiseState::FRAME_SIZE],
    frame_out: [f32; DenoiseState::FRAME_SIZE],
    voice: f32,
    /// Sprach-Gate: aktuelle Verstärkung und Haltezeit in Rahmen.
    gate_gain: f32,
    hold: usize,
}

/// Ab dieser Sprachwahrscheinlichkeit gilt ein Rahmen als Sprache. Echte
/// Sprache liegt meist über 0,9; Rauschen und Klicks schwanken bis etwa 0,7.
const VOICE_THRESHOLD: f32 = 0.8;
/// So lange (in 10-ms-Rahmen) bleibt das Sprach-Gate nach Sprache offen.
const VOICE_HOLD: usize = 30;
/// Absenkung außerhalb von Sprache: −40 dB.
const VOICE_CLOSED: f32 = 0.01;

impl Denoiser {
    fn new() -> Self {
        let mut d = Self {
            state: DenoiseState::new(),
            input: VecDeque::with_capacity(16_384),
            output: VecDeque::with_capacity(16_384),
            frame_in: [0.0; DenoiseState::FRAME_SIZE],
            frame_out: [0.0; DenoiseState::FRAME_SIZE],
            voice: 0.0,
            gate_gain: 1.0,
            hold: VOICE_HOLD,
        };
        d.reset();
        d
    }

    fn reset(&mut self) {
        self.input.clear();
        self.output.clear();
        self.output
            .extend(std::iter::repeat_n(0.0, DenoiseState::FRAME_SIZE));
    }

    /// Gibt zurück, ob das Sprach-Gate gerade offen ist.
    fn process(&mut self, buf: &mut [f32], voice_gate: bool) -> bool {
        self.input.extend(buf.iter().map(|s| s * 32_768.0));
        while self.input.len() >= DenoiseState::FRAME_SIZE {
            for (dst, src) in self
                .frame_in
                .iter_mut()
                .zip(self.input.drain(..DenoiseState::FRAME_SIZE))
            {
                *dst = src;
            }
            self.voice = self
                .state
                .process_frame(&mut self.frame_out, &self.frame_in);

            // Sprach-Gate: sofort auf, nach der Haltezeit sanft zu (~40 ms).
            if self.voice >= VOICE_THRESHOLD {
                self.hold = VOICE_HOLD;
            } else {
                self.hold = self.hold.saturating_sub(1);
            }
            let target = if !voice_gate || self.hold > 0 {
                1.0
            } else {
                VOICE_CLOSED
            };
            let end = if target > self.gate_gain {
                target
            } else {
                self.gate_gain + (target - self.gate_gain) * 0.25
            };
            let step = (end - self.gate_gain) / DenoiseState::FRAME_SIZE as f32;
            let mut gain = self.gate_gain;
            for s in self.frame_out.iter() {
                gain += step;
                self.output.push_back(s / 32_768.0 * gain);
            }
            self.gate_gain = end;
        }
        for s in buf.iter_mut() {
            *s = self.output.pop_front().unwrap_or(0.0);
        }
        !voice_gate || self.hold > 0
    }
}

struct Equalizer {
    bands: [Biquad; 3],
}

impl Equalizer {
    fn new() -> Self {
        let mut eq = Self {
            bands: [Biquad::default(); 3],
        };
        eq.configure(&EqParams::default());
        eq
    }

    fn configure(&mut self, p: &EqParams) {
        self.bands[0].design(Shape::LowShelf, 120.0, 0.707, p.low_db);
        self.bands[1].design(Shape::Peak, 2_500.0, 0.9, p.mid_db);
        self.bands[2].design(Shape::HighShelf, 8_000.0, 0.707, p.high_db);
    }

    fn process(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            let mut x = *s;
            for band in &mut self.bands {
                x = band.process(x);
            }
            *s = x;
        }
    }
}

/// Automatische Lautstärke: gleicht die Sprechlautstärke langsam auf einen
/// Zielwert an und passt sich nur an, solange gesprochen wird.
struct Agc {
    loudness_db: f32,
    gain_db: f32,
}

impl Agc {
    fn new() -> Self {
        Self {
            loudness_db: AgcParams::default().target_db,
            gain_db: 0.0,
        }
    }

    fn process(&mut self, buf: &mut [f32], p: &AgcParams, speaking: bool) -> f32 {
        if buf.is_empty() {
            return self.gain_db;
        }
        let seconds = buf.len() as f32 / RATE;
        let rms = (buf.iter().map(|x| x * x).sum::<f32>() / buf.len() as f32).sqrt();
        let level = to_db(rms);
        if speaking && level > -50.0 {
            // Lautheit über etwa 1,5 s mitteln.
            let alpha = (seconds / 1.5).min(1.0);
            self.loudness_db += (level - self.loudness_db) * alpha;
        }
        let desired = (p.target_db - self.loudness_db).clamp(-12.0, p.max_gain_db);
        // Anheben langsam (6 dB/s), absenken schneller (18 dB/s).
        let rate = if desired > self.gain_db { 6.0 } else { 18.0 };
        let max_step = rate * seconds;
        let next = self.gain_db + (desired - self.gain_db).clamp(-max_step, max_step);
        let (from, to) = (db_to_gain(self.gain_db), db_to_gain(next));
        let step = (to - from) / buf.len() as f32;
        let mut gain = from;
        for s in buf.iter_mut() {
            gain += step;
            *s *= gain;
        }
        self.gain_db = next;
        next
    }
}

struct Compressor {
    envelope_db: f32,
    attack: f32,
    release: f32,
}

impl Compressor {
    fn new() -> Self {
        Self {
            envelope_db: -120.0,
            attack: coef(5.0),
            release: coef(150.0),
        }
    }

    /// Liefert die stärkste Absenkung des Blocks in dB.
    fn process(&mut self, buf: &mut [f32], p: &CompressorParams) -> f32 {
        let slope = 1.0 - 1.0 / p.ratio;
        let makeup = db_to_gain(p.makeup_db);
        let mut most = 0.0f32;
        for s in buf.iter_mut() {
            let level = to_db(s.abs());
            let c = if level > self.envelope_db {
                self.attack
            } else {
                self.release
            };
            self.envelope_db = level + (self.envelope_db - level) * c;
            let reduction = if self.envelope_db > p.threshold_db {
                (p.threshold_db - self.envelope_db) * slope
            } else {
                0.0
            };
            most = most.min(reduction);
            *s *= db_to_gain(reduction) * makeup;
        }
        most
    }
}

// ------------------------------------------------------------ Kette

pub struct EffectChain {
    params: EffectsParams,
    version: u64,
    gate: Gate,
    denoise: Denoiser,
    denoise_active: bool,
    eq: Equalizer,
    agc: Agc,
    compressor: Compressor,
    limiter: Limiter,
}

impl Default for EffectChain {
    fn default() -> Self {
        Self::new()
    }
}

impl EffectChain {
    pub fn new() -> Self {
        let params = EffectsParams::default();
        Self {
            limiter: Limiter::new(params.limiter.ceiling_db, 80.0, ENGINE_RATE),
            params,
            version: u64::MAX,
            gate: Gate::new(),
            denoise: Denoiser::new(),
            denoise_active: false,
            eq: Equalizer::new(),
            agc: Agc::new(),
            compressor: Compressor::new(),
        }
    }

    /// Neue Einstellungen übernehmen, ohne den Audio-Thread zu blockieren.
    fn sync(&mut self, shared: &EffectsShared) {
        let version = shared.version.load(Ordering::Acquire);
        if version == self.version {
            return;
        }
        let Some(params) = shared.params.try_lock().map(|p| *p) else {
            return;
        };
        self.version = version;
        if params.eq != self.params.eq {
            self.eq.configure(&params.eq);
        }
        if params.limiter.ceiling_db != self.params.limiter.ceiling_db {
            self.limiter = Limiter::new(params.limiter.ceiling_db, 80.0, ENGINE_RATE);
        }
        self.params = params;
    }

    pub fn process(&mut self, buf: &mut [f32], shared: &EffectsShared) {
        self.sync(shared);
        let p = self.params;

        let open = if p.gate.enabled {
            self.gate.process(buf, db_to_gain(p.gate.threshold_db))
        } else {
            true
        };
        shared.gate_open.store(open, Ordering::Relaxed);

        let mut voice_open = true;
        if p.denoise.enabled {
            if !self.denoise_active {
                self.denoise.reset();
                self.denoise_active = true;
            }
            voice_open = self.denoise.process(buf, p.denoise.voice_gate);
            shared.voice.store(self.denoise.voice);
        } else {
            self.denoise_active = false;
            shared.voice.store(0.0);
        }
        shared.voice_open.store(voice_open, Ordering::Relaxed);

        if p.eq.enabled {
            self.eq.process(buf);
        }

        if p.agc.enabled {
            // Sprache: laut RNNoise, sonst grob am Pegel erkannt.
            let speaking = if p.denoise.enabled {
                self.denoise.voice >= VOICE_THRESHOLD
            } else {
                let rms = (buf.iter().map(|x| x * x).sum::<f32>() / buf.len().max(1) as f32).sqrt();
                to_db(rms) > -45.0
            };
            let gain = self.agc.process(buf, &p.agc, speaking);
            shared.agc_gain_db.store(gain);
        } else {
            shared.agc_gain_db.store(0.0);
        }

        let reduction = if p.compressor.enabled {
            self.compressor.process(buf, &p.compressor)
        } else {
            0.0
        };
        shared.compressor_reduction_db.store(reduction);

        if p.limiter.enabled {
            self.limiter.process(buf);
            shared
                .limiter_reduction_db
                .store(self.limiter.gain_reduction_db());
        } else {
            shared.limiter_reduction_db.store(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, amp: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (i as f32 * std::f32::consts::TAU * freq / RATE).sin() * amp)
            .collect()
    }

    fn rms(buf: &[f32]) -> f32 {
        (buf.iter().map(|x| x * x).sum::<f32>() / buf.len() as f32).sqrt()
    }

    fn run(params: EffectsParams, input: &[f32]) -> Vec<f32> {
        let shared = EffectsShared::default();
        shared.set(params);
        let mut chain = EffectChain::new();
        let mut out = Vec::new();
        for block in input.chunks(480) {
            let mut b = block.to_vec();
            chain.process(&mut b, &shared);
            out.extend(b);
        }
        out
    }

    #[test]
    fn all_off_is_transparent() {
        let input = sine(440.0, 0.5, 4800);
        assert_eq!(run(EffectsParams::default(), &input), input);
    }

    #[test]
    fn gate_mutes_quiet_signal() {
        let mut p = EffectsParams::default();
        p.gate.enabled = true;
        p.gate.threshold_db = -40.0;
        let out = run(p, &sine(440.0, 0.001, 48_000));
        assert!(rms(&out[24_000..]) < 0.0001);
    }

    #[test]
    fn eq_boosts_bass() {
        let mut p = EffectsParams::default();
        p.eq.enabled = true;
        p.eq.low_db = 6.0;
        let input = sine(60.0, 0.1, 48_000);
        let out = run(p, &input);
        let gain = to_db(rms(&out[24_000..]) / rms(&input[24_000..]));
        assert!((gain - 6.0).abs() < 1.0, "{gain}");
    }

    #[test]
    fn compressor_reduces_loud_signal() {
        let p = EffectsParams {
            compressor: CompressorParams {
                enabled: true,
                threshold_db: -20.0,
                ratio: 4.0,
                makeup_db: 0.0,
            },
            ..Default::default()
        };
        let input = sine(440.0, 0.5, 48_000);
        let out = run(p, &input);
        assert!(rms(&out[24_000..]) < rms(&input[24_000..]) * 0.5);
    }

    #[test]
    fn agc_lifts_quiet_speech_towards_target() {
        let p = EffectsParams {
            agc: AgcParams {
                enabled: true,
                target_db: -20.0,
                max_gain_db: 18.0,
            },
            ..Default::default()
        };
        // Leise „Sprache“: −36 dB RMS, liegt über der Sprech-Schwelle von −45 dB.
        let input = sine(300.0, 0.0225, 48_000 * 6);
        let out = run(p, &input);
        let level = to_db(rms(&out[out.len() - 48_000..]));
        assert!((level + 20.0).abs() < 2.0, "{level}");
    }

    #[test]
    fn agc_never_exceeds_max_gain() {
        let p = EffectsParams {
            agc: AgcParams {
                enabled: true,
                target_db: -10.0,
                max_gain_db: 6.0,
            },
            ..Default::default()
        };
        let input = sine(300.0, 0.0225, 48_000 * 6);
        let out = run(p, &input);
        let gain = to_db(rms(&out[out.len() - 48_000..]) / rms(&input[..48_000]));
        assert!(gain <= 6.1, "{gain}");
    }

    #[test]
    fn voice_gate_mutes_noise_without_speech() {
        let mut p = EffectsParams::default();
        p.denoise.enabled = true;
        // Breitbandiges Rauschen statt Sprache.
        let mut seed: u32 = 1;
        let noise: Vec<f32> = (0..48_000 * 2)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.2
            })
            .collect();
        let with_gate = run(p, &noise);
        p.denoise.voice_gate = false;
        let without = run(p, &noise);
        let tail = |v: &[f32]| rms(&v[v.len() - 24_000..]);
        assert!(tail(&with_gate) < tail(&without) * 0.05 + 1e-6);
    }

    #[test]
    fn denoise_delays_by_one_frame_and_runs() {
        let mut p = EffectsParams::default();
        p.denoise.enabled = true;
        let out = run(p, &sine(440.0, 0.3, 9_600));
        assert_eq!(out.len(), 9_600);
        assert!(out[..480].iter().all(|&s| s == 0.0));
    }
}
