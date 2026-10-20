//! Klangcharakter: Roboter (Ringmodulator), Radio, Telefon, Megafon,
//! Verzerrung, Bitcrusher und Lo-Fi (Kassette). Jeder Modus hat zwei Regler, `amount` (wie
//! stark) und `tone` (Farbe), deren Bedeutung der Modus festlegt.

use std::f32::consts::TAU;

use serde::{Deserialize, Serialize};

use crate::audio::ENGINE_RATE;
use crate::audio::dsp::{Biquad, DelayLine, Shape};

const RATE: f32 = ENGINE_RATE as f32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CharacterMode {
    /// Ringmodulator mit metallischem Kamm. Tone: Trägerfrequenz.
    #[default]
    Robot,
    /// Schmales Band, leicht übersteuert, etwas Rauschen. Tone: Bandmitte.
    Radio,
    /// 300–3400 Hz, grob abgetastet. Tone: Bandbreite.
    Telephone,
    /// Harte Mitten, kräftig übersteuert. Tone: Resonanz.
    Megaphone,
    /// Sättigung bis Fuzz. Tone: Höhen.
    Distortion,
    /// Weniger Bits und Abtastrate. Tone: Abtastrate.
    Bitcrusher,
    /// Alte Kassette: schmales Band, warm gesättigt, leiernd, mit Rauschen
    /// und Knistern. Amount: wie abgenutzt. Tone: Höhen.
    Lofi,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CharacterParams {
    pub enabled: bool,
    pub mode: CharacterMode,
    /// 0–1.
    pub amount: f32,
    /// 0–1.
    pub tone: f32,
    /// Anteil 0–1.
    pub mix: f32,
}

impl Default for CharacterParams {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: CharacterMode::Robot,
            amount: 0.5,
            tone: 0.5,
            mix: 1.0,
        }
    }
}

impl CharacterParams {
    pub fn clamped(mut self) -> Self {
        self.amount = self.amount.clamp(0.0, 1.0);
        self.tone = self.tone.clamp(0.0, 1.0);
        self.mix = self.mix.clamp(0.0, 1.0);
        self
    }

    /// Trägerfrequenz des Roboters in Hz.
    pub fn robot_hz(&self) -> f32 {
        30.0 * 10f32.powf(self.tone)
    }
}

/// Weiche Sättigung, bei großem Eingang gegen ±1.
#[inline]
fn soft_clip(x: f32) -> f32 {
    x.tanh()
}

pub struct Character {
    params: CharacterParams,
    filters: [Biquad; 3],
    comb: DelayLine,
    phase: f32,
    /// Zweiter Oszillator: schnelles Flattern des Bandes.
    flutter: f32,
    /// Abklingendes Knacken.
    crackle: f32,
    hold: f32,
    hold_count: usize,
    noise: u32,
}

impl Default for Character {
    fn default() -> Self {
        Self::new()
    }
}

impl Character {
    pub fn new() -> Self {
        let mut c = Self {
            params: CharacterParams {
                mode: CharacterMode::Bitcrusher,
                ..Default::default()
            },
            filters: [Biquad::default(); 3],
            comb: DelayLine::new(1024),
            phase: 0.0,
            flutter: 0.0,
            crackle: 0.0,
            hold: 0.0,
            hold_count: 0,
            noise: 0x1234_5678,
        };
        c.configure(&CharacterParams::default());
        c
    }

    pub fn configure(&mut self, p: &CharacterParams) {
        let mode_changed = p.mode != self.params.mode;
        self.params = *p;
        let flat = (Shape::Peak, 1000.0, 1.0, 0.0);
        let designs: [(Shape, f32, f32, f32); 3] = match p.mode {
            CharacterMode::Robot | CharacterMode::Bitcrusher => [flat; 3],
            CharacterMode::Radio => {
                let center = 800.0 * 2f32.powf(p.tone * 2.0);
                [
                    (Shape::HighPass, center * 0.4, 0.8, 0.0),
                    (Shape::LowPass, center * 3.0, 0.9, 0.0),
                    (Shape::Peak, center, 1.2, 4.0),
                ]
            }
            CharacterMode::Telephone => {
                let narrow = 1.0 - p.tone * 0.5;
                [
                    (Shape::HighPass, 300.0 / narrow, 0.9, 0.0),
                    (Shape::LowPass, 3_400.0 * narrow, 0.9, 0.0),
                    (Shape::HighPass, 300.0 / narrow, 0.9, 0.0),
                ]
            }
            CharacterMode::Megaphone => [
                (Shape::HighPass, 650.0, 0.9, 0.0),
                (Shape::Peak, 1_800.0, 2.0, 4.0 + p.tone * 10.0),
                (Shape::LowPass, 4_500.0, 0.8, 0.0),
            ],
            CharacterMode::Distortion => [
                (Shape::HighPass, 80.0, 0.7, 0.0),
                (Shape::LowPass, 1_000.0 * 12f32.powf(p.tone), 0.7, 0.0),
                flat,
            ],
            CharacterMode::Lofi => [
                (Shape::HighPass, 180.0, 0.7, 0.0),
                (Shape::LowPass, 2_000.0 * 3f32.powf(p.tone), 0.6, 0.0),
                // Etwas Wärme in den unteren Mitten, wie bei Band.
                (Shape::Peak, 400.0, 0.8, 2.5),
            ],
        };
        // Nur die Koeffizienten tauschen, damit Regler nicht knacken.
        for (filter, (shape, freq, q, gain)) in self.filters.iter_mut().zip(designs) {
            filter.design(shape, freq, q, gain);
        }
        if mode_changed {
            self.clear();
        }
    }

    #[inline]
    fn noise(&mut self) -> f32 {
        self.noise ^= self.noise << 13;
        self.noise ^= self.noise >> 17;
        self.noise ^= self.noise << 5;
        self.noise as f32 / u32::MAX as f32 * 2.0 - 1.0
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        let p = self.params;
        for s in buf.iter_mut() {
            let x = *s;
            let wet = match p.mode {
                CharacterMode::Robot => {
                    self.phase = (self.phase + p.robot_hz() / RATE).fract();
                    let ring = x * (TAU * self.phase).sin();
                    // Kurzer Kamm bei 6 ms für den metallischen Klang.
                    let comb = self.comb.tap(288);
                    let y = ring * (0.5 + p.amount * 0.5) + x * (1.0 - p.amount) * 0.5;
                    self.comb.push(y + comb * 0.55 * p.amount);
                    (y + comb * 0.6 * p.amount) * 1.4
                }
                CharacterMode::Radio => {
                    let mut y = x;
                    for f in &mut self.filters {
                        y = f.process(y);
                    }
                    let drive = 1.0 + p.amount * 8.0;
                    let hiss = self.noise() * 0.004 * p.amount;
                    soft_clip(y * drive) / drive.sqrt() + hiss
                }
                CharacterMode::Telephone => {
                    let mut y = x;
                    for f in &mut self.filters {
                        y = f.process(y);
                    }
                    // Abtasten mit 8 kHz, Stufen mit 6–12 Bit.
                    if self.hold_count == 0 {
                        self.hold = y;
                        self.hold_count = 6;
                    }
                    self.hold_count -= 1;
                    let steps = 2f32.powf(12.0 - p.amount * 6.0);
                    let q = (self.hold * steps).round() / steps;
                    soft_clip(q * (1.0 + p.amount * 3.0)) * 1.2
                }
                CharacterMode::Megaphone => {
                    let mut y = x;
                    for f in &mut self.filters[..2] {
                        y = f.process(y);
                    }
                    let drive = 2.0 + p.amount * 14.0;
                    let y = soft_clip(y * drive) * 0.7;
                    self.filters[2].process(y)
                }
                CharacterMode::Distortion => {
                    let y = self.filters[0].process(x);
                    let drive = 1.0 + p.amount * 40.0;
                    // Leicht unsymmetrisch für mehr gerade Obertöne.
                    let d = soft_clip(y * drive + 0.1) - 0.1f32.tanh();
                    self.filters[1].process(d) / (1.0 + p.amount * 1.5)
                }
                CharacterMode::Lofi => {
                    // Leiern (0,5 Hz) und Flattern (6 Hz) über eine gleitende Verzögerung.
                    self.phase = (self.phase + 0.5 / RATE).fract();
                    self.flutter = (self.flutter + 6.0 / RATE).fract();
                    let wobble = (TAU * self.phase).sin() * 30.0 * p.amount
                        + (TAU * self.flutter).sin() * 3.0 * p.amount;
                    self.comb.push(x);
                    let mut y = self.comb.read(160.0 + wobble);
                    for f in &mut self.filters {
                        y = f.process(y);
                    }
                    // Warme Sättigung, Pegel bleibt gleich.
                    let y = soft_clip(y * 1.8) / 1.8f32.tanh();
                    // Bandrauschen, leise und dunkel.
                    let hiss = self.noise() * 0.006 * p.amount;
                    // Seltenes Knistern wie Staub auf der Platte.
                    if self.noise() > 1.0 - 0.0004 * p.amount {
                        self.crackle = self.noise() * 0.25 * p.amount;
                    }
                    self.crackle *= 0.85;
                    // 12 Bit.
                    let q = ((y + hiss + self.crackle) * 2048.0).round() / 2048.0;
                    q * 1.1
                }
                CharacterMode::Bitcrusher => {
                    let factor = 1 + (p.tone * p.tone * 31.0) as usize;
                    if self.hold_count == 0 {
                        self.hold = x;
                        self.hold_count = factor;
                    }
                    self.hold_count -= 1;
                    let bits = 16.0 - p.amount * 14.0;
                    let steps = 2f32.powf(bits - 1.0);
                    (self.hold * steps).round() / steps
                }
            };
            *s = x * (1.0 - p.mix) + wet * p.mix;
        }
    }

    pub fn clear(&mut self) {
        self.filters.iter_mut().for_each(Biquad::reset);
        self.comb.clear();
        self.hold = 0.0;
        self.hold_count = 0;
        self.crackle = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mode_produces_sound_without_blowing_up() {
        for mode in [
            CharacterMode::Robot,
            CharacterMode::Radio,
            CharacterMode::Telephone,
            CharacterMode::Megaphone,
            CharacterMode::Distortion,
            CharacterMode::Bitcrusher,
            CharacterMode::Lofi,
        ] {
            for amount in [0.0, 1.0] {
                let mut c = Character::new();
                c.configure(&CharacterParams {
                    enabled: true,
                    mode,
                    amount,
                    tone: 0.5,
                    mix: 1.0,
                });
                let mut buf: Vec<f32> = (0..48_000)
                    .map(|i| (i as f32 * TAU * 1_000.0 / RATE).sin() * 0.5)
                    .collect();
                c.process(&mut buf);
                let rms = (buf.iter().map(|x| x * x).sum::<f32>() / buf.len() as f32).sqrt();
                assert!(
                    buf.iter().all(|s| s.is_finite() && s.abs() < 2.0),
                    "{mode:?}"
                );
                assert!(rms > 0.02, "{mode:?} {amount} {rms}");
            }
        }
    }

    #[test]
    fn telephone_cuts_bass() {
        let mut c = Character::new();
        c.configure(&CharacterParams {
            enabled: true,
            mode: CharacterMode::Telephone,
            amount: 0.0,
            tone: 0.0,
            mix: 1.0,
        });
        let mut buf: Vec<f32> = (0..48_000)
            .map(|i| (i as f32 * TAU * 80.0 / RATE).sin() * 0.5)
            .collect();
        c.process(&mut buf);
        let rms = (buf[24_000..].iter().map(|x| x * x).sum::<f32>() / 24_000.0).sqrt();
        assert!(rms < 0.05, "{rms}");
    }
}
