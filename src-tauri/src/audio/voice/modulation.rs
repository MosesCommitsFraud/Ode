//! Modulation: Chorus, Flanger und Phaser. Ein langsamer Oszillator (LFO)
//! bewegt kurze Verzögerungen bzw. Allpass-Filter.

use std::f32::consts::TAU;

use serde::{Deserialize, Serialize};

use crate::audio::ENGINE_RATE;
use crate::audio::dsp::DelayLine;

const RATE: f32 = ENGINE_RATE as f32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModulationMode {
    /// Mehrere leicht verstimmte Kopien: breiter, „mehr Stimmen“.
    #[default]
    Chorus,
    /// Sehr kurze, rückgekoppelte Verzögerung: Düsenjet-Rauschen.
    Flanger,
    /// Wandernde Kerben im Spektrum.
    Phaser,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModulationParams {
    pub enabled: bool,
    pub mode: ModulationMode,
    /// Geschwindigkeit des LFO in Hz.
    pub rate_hz: f32,
    /// Tiefe 0–1.
    pub depth: f32,
    /// Rückkopplung 0–0,9 (Flanger und Phaser).
    pub feedback: f32,
    /// Anteil 0–1.
    pub mix: f32,
}

impl Default for ModulationParams {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: ModulationMode::Chorus,
            rate_hz: 0.8,
            depth: 0.5,
            feedback: 0.3,
            mix: 0.5,
        }
    }
}

impl ModulationParams {
    pub fn clamped(mut self) -> Self {
        self.rate_hz = self.rate_hz.clamp(0.05, 8.0);
        self.depth = self.depth.clamp(0.0, 1.0);
        self.feedback = self.feedback.clamp(0.0, 0.9);
        self.mix = self.mix.clamp(0.0, 1.0);
        self
    }
}

/// Allpass erster Ordnung für den Phaser.
#[derive(Debug, Clone, Copy, Default)]
struct FirstOrderAllpass {
    z: f32,
}

impl FirstOrderAllpass {
    #[inline]
    fn process(&mut self, x: f32, a: f32) -> f32 {
        let y = -a * x + self.z;
        self.z = x + a * y;
        y
    }
}

const PHASER_STAGES: usize = 6;

pub struct Modulation {
    line: DelayLine,
    phase: f32,
    last: f32,
    stages: [FirstOrderAllpass; PHASER_STAGES],
}

impl Default for Modulation {
    fn default() -> Self {
        Self::new()
    }
}

impl Modulation {
    pub fn new() -> Self {
        Self {
            line: DelayLine::new((RATE * 0.05) as usize),
            phase: 0.0,
            last: 0.0,
            stages: [FirstOrderAllpass::default(); PHASER_STAGES],
        }
    }

    pub fn process(&mut self, buf: &mut [f32], p: &ModulationParams) {
        let step = p.rate_hz / RATE;
        for s in buf.iter_mut() {
            self.phase = (self.phase + step).fract();
            let x = *s;
            let wet = match p.mode {
                ModulationMode::Chorus => {
                    self.line.push(x);
                    // Drei Stimmen mit versetzter Phase um 15 ms herum.
                    let mut sum = 0.0;
                    for voice in 0..3 {
                        let lfo = (TAU * (self.phase + voice as f32 / 3.0)).sin();
                        let ms = 15.0 + voice as f32 * 4.0 + lfo * 6.0 * p.depth;
                        sum += self.line.read(ms / 1000.0 * RATE);
                    }
                    sum / 3.0
                }
                ModulationMode::Flanger => {
                    let lfo = 0.5 + 0.5 * (TAU * self.phase).sin();
                    let ms = 0.3 + lfo * 4.5 * p.depth.max(0.05);
                    let y = self.line.read(ms / 1000.0 * RATE);
                    self.line.push(x + y * p.feedback);
                    y
                }
                ModulationMode::Phaser => {
                    let lfo = 0.5 + 0.5 * (TAU * self.phase).sin();
                    // Kerben wandern zwischen 200 Hz und bis zu 3 kHz.
                    let freq = 200.0 * (1.0 + lfo * 14.0 * p.depth.max(0.05));
                    let t = (std::f32::consts::PI * freq / RATE).tan();
                    let a = (1.0 - t) / (1.0 + t);
                    let mut y = x + self.last * p.feedback;
                    for stage in &mut self.stages {
                        y = stage.process(y, a);
                    }
                    self.last = y;
                    y
                }
            };
            *s = x * (1.0 - p.mix * 0.5) + wet * p.mix;
        }
    }

    pub fn clear(&mut self) {
        self.line.clear();
        self.last = 0.0;
        self.stages = [FirstOrderAllpass::default(); PHASER_STAGES];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_modes_stay_bounded() {
        for mode in [
            ModulationMode::Chorus,
            ModulationMode::Flanger,
            ModulationMode::Phaser,
        ] {
            let p = ModulationParams {
                enabled: true,
                mode,
                rate_hz: 2.0,
                depth: 1.0,
                feedback: 0.9,
                mix: 1.0,
            };
            let mut m = Modulation::new();
            let mut buf: Vec<f32> = (0..48_000)
                .map(|i| (i as f32 * TAU * 220.0 / RATE).sin() * 0.5)
                .collect();
            m.process(&mut buf, &p);
            assert!(
                buf.iter().all(|s| s.is_finite() && s.abs() < 4.0),
                "{mode:?}"
            );
            let rms = (buf.iter().map(|x| x * x).sum::<f32>() / buf.len() as f32).sqrt();
            assert!(rms > 0.05, "{mode:?} {rms}");
        }
    }
}
