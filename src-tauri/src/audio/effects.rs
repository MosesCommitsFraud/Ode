//! Mikrofon-Effektkette in fester Reihenfolge: Noise Gate → Rauschunterdrückung
//! (RNNoise) → Equalizer → Kompressor → Limiter. Jeder Effekt ist einzeln
//! schaltbar. Die Kette läuft im Eingangs-Callback in Engine-Rate.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use nnnoiseless::DenoiseState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::ENGINE_RATE;
use super::dsp::{AtomicF32, Limiter, db_to_gain};

const RATE: f32 = ENGINE_RATE as f32;

fn coef(ms: f32) -> f32 {
    (-1.0 / (ms / 1000.0 * RATE)).exp()
}

fn to_db(x: f32) -> f32 {
    20.0 * x.max(1e-9).log10()
}

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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DenoiseParams {
    pub enabled: bool,
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
}

impl Denoiser {
    fn new() -> Self {
        let mut d = Self {
            state: DenoiseState::new(),
            input: VecDeque::with_capacity(16_384),
            output: VecDeque::with_capacity(16_384),
            frame_in: [0.0; DenoiseState::FRAME_SIZE],
            frame_out: [0.0; DenoiseState::FRAME_SIZE],
            voice: 0.0,
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

    fn process(&mut self, buf: &mut [f32]) {
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
            self.output
                .extend(self.frame_out.iter().map(|s| s / 32_768.0));
        }
        for s in buf.iter_mut() {
            *s = self.output.pop_front().unwrap_or(0.0);
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

#[derive(Clone, Copy)]
enum Shape {
    LowShelf,
    Peak,
    HighShelf,
}

impl Biquad {
    /// Koeffizienten nach dem Audio-EQ-Cookbook (R. Bristow-Johnson).
    fn design(&mut self, shape: Shape, freq: f32, q: f32, gain_db: f32) {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = std::f32::consts::TAU * freq / RATE;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let (b0, b1, b2, a0, a1, a2) = match shape {
            Shape::Peak => (
                1.0 + alpha * a,
                -2.0 * cos,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos,
                1.0 - alpha / a,
            ),
            Shape::LowShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + k),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - k),
                    (a + 1.0) + (a - 1.0) * cos + k,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - k,
                )
            }
            Shape::HighShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + k),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - k),
                    (a + 1.0) - (a - 1.0) * cos + k,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - k,
                )
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
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

        if p.denoise.enabled {
            if !self.denoise_active {
                self.denoise.reset();
                self.denoise_active = true;
            }
            self.denoise.process(buf);
            shared.voice.store(self.denoise.voice);
        } else {
            self.denoise_active = false;
            shared.voice.store(0.0);
        }

        if p.eq.enabled {
            self.eq.process(buf);
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
    fn denoise_delays_by_one_frame_and_runs() {
        let mut p = EffectsParams::default();
        p.denoise.enabled = true;
        let out = run(p, &sine(440.0, 0.3, 9_600));
        assert_eq!(out.len(), 9_600);
        assert!(out[..480].iter().all(|&s| s == 0.0));
    }
}
