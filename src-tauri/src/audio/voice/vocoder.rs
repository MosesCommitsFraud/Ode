//! Kanal-Vocoder: Die Stimme steuert in 16 Bändern die Lautstärke eines
//! Synthesizer-Trägers (Sägezahn-Akkord mit etwas Rauschen). Der Träger
//! spielt eine feste Note oder folgt der erkannten Tonhöhe.

use serde::{Deserialize, Serialize};

use super::pitch::hz_of;
use crate::audio::ENGINE_RATE;
use crate::audio::dsp::{Biquad, Shape, coef};

const RATE: f32 = ENGINE_RATE as f32;
pub const BANDS: usize = 16;
const LOWEST: f32 = 120.0;
const HIGHEST: f32 = 7_500.0;
const Q: f32 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Chord {
    #[default]
    Single,
    Fifth,
    Major,
    Minor,
}

impl Chord {
    fn intervals(self) -> &'static [f32] {
        match self {
            Chord::Single => &[0.0],
            Chord::Fifth => &[0.0, 7.0, 12.0],
            Chord::Major => &[0.0, 4.0, 7.0],
            Chord::Minor => &[0.0, 3.0, 7.0],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VocoderParams {
    pub enabled: bool,
    /// Grundton des Trägers als Midi-Note (48 = C3).
    pub note: f32,
    /// Träger folgt der gesungenen Tonhöhe statt der festen Note.
    pub follow: bool,
    pub chord: Chord,
    /// Rauschanteil des Trägers 0–1, für Zischlaute.
    pub breath: f32,
    /// Anteil 0–1.
    pub mix: f32,
}

impl Default for VocoderParams {
    fn default() -> Self {
        Self {
            enabled: false,
            note: 48.0,
            follow: false,
            chord: Chord::Single,
            breath: 0.2,
            mix: 1.0,
        }
    }
}

impl VocoderParams {
    pub fn clamped(mut self) -> Self {
        self.note = self.note.clamp(28.0, 76.0);
        self.breath = self.breath.clamp(0.0, 1.0);
        self.mix = self.mix.clamp(0.0, 1.0);
        self
    }
}

/// Bandbegrenzter Sägezahn (PolyBLEP).
#[derive(Debug, Clone, Copy, Default)]
struct Saw {
    phase: f32,
}

impl Saw {
    #[inline]
    fn next(&mut self, freq: f32) -> f32 {
        let dt = (freq / RATE).min(0.5);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        let t = self.phase;
        let mut y = 2.0 * t - 1.0;
        if t < dt {
            let x = t / dt;
            y -= x + x - x * x - 1.0;
        } else if t > 1.0 - dt {
            let x = (t - 1.0) / dt;
            y -= x * x + x + x + 1.0;
        }
        y
    }
}

pub fn band_frequency(i: usize) -> f32 {
    LOWEST * (HIGHEST / LOWEST).powf(i as f32 / (BANDS - 1) as f32)
}

pub struct Vocoder {
    analysis: [Biquad; BANDS],
    synthesis: [Biquad; BANDS],
    envelope: [f32; BANDS],
    saws: [Saw; 3],
    /// Geglättete Trägerfrequenz, damit Notenwechsel nicht knacken.
    freq: f32,
    noise: u32,
    attack: f32,
    release: f32,
    /// Höchste Hüllkurve je Band seit dem letzten Auslesen, für die Anzeige.
    pub levels: [f32; BANDS],
}

impl Default for Vocoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Vocoder {
    pub fn new() -> Self {
        let filter = |i| Biquad::new(Shape::BandPass, band_frequency(i), Q, 0.0);
        Self {
            analysis: std::array::from_fn(filter),
            synthesis: std::array::from_fn(filter),
            envelope: [0.0; BANDS],
            saws: [Saw::default(); 3],
            freq: hz_of(48.0),
            noise: 0x2545_f491,
            attack: coef(3.0),
            release: coef(30.0),
            levels: [0.0; BANDS],
        }
    }

    /// `pitch` ist die erkannte Tonhöhe der Stimme, falls stimmhaft.
    pub fn process(&mut self, buf: &mut [f32], p: &VocoderParams, pitch: Option<f32>) {
        let target = match (p.follow, pitch) {
            (true, Some(hz)) => hz,
            // Ohne erkannte Tonhöhe die letzte halten.
            (true, None) => self.freq,
            (false, _) => hz_of(p.note),
        };
        let intervals = p.chord.intervals();
        let voices = intervals.len() as f32;
        for s in buf.iter_mut() {
            let x = *s;
            self.freq += (target - self.freq) * 0.002;
            let mut carrier = 0.0;
            for (saw, &interval) in self.saws.iter_mut().zip(intervals) {
                carrier += saw.next(self.freq * 2f32.powf(interval / 12.0));
            }
            carrier /= voices.sqrt();
            self.noise ^= self.noise << 13;
            self.noise ^= self.noise >> 17;
            self.noise ^= self.noise << 5;
            let noise = self.noise as f32 / u32::MAX as f32 * 2.0 - 1.0;
            carrier = carrier * (1.0 - p.breath * 0.5) + noise * p.breath;

            let mut out = 0.0;
            for b in 0..BANDS {
                let level = self.analysis[b].process(x).abs();
                let env = &mut self.envelope[b];
                let c = if level > *env {
                    self.attack
                } else {
                    self.release
                };
                *env = level + (*env - level) * c;
                self.levels[b] = self.levels[b].max(*env);
                out += self.synthesis[b].process(carrier) * *env;
            }
            *s = x * (1.0 - p.mix) + out * 4.0 * p.mix;
        }
    }

    pub fn take_levels(&mut self) -> [f32; BANDS] {
        std::mem::replace(&mut self.levels, [0.0; BANDS])
    }

    pub fn clear(&mut self) {
        self.analysis.iter_mut().for_each(Biquad::reset);
        self.synthesis.iter_mut().for_each(Biquad::reset);
        self.envelope = [0.0; BANDS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn follows_the_voice_level() {
        // Sprachähnlich: Sägezahn bei 150 Hz.
        let input: Vec<f32> = (0..48_000)
            .map(|i| ((i as f32 * 150.0 / RATE).fract() * 2.0 - 1.0) * 0.2)
            .collect();
        let mut v = Vocoder::new();
        let mut out = input.clone();
        v.process(&mut out, &VocoderParams::default(), None);
        let gain = rms(&out[24_000..]) / rms(&input[24_000..]);
        assert!(gain > 0.4 && gain < 2.5, "{gain}");

        let mut silent = vec![0.0f32; 9_600];
        v.process(&mut silent, &VocoderParams::default(), None);
        assert!(rms(&silent[4_800..]) < 0.005);
    }
}
