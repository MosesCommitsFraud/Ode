//! Modulation: Chorus, Flanger und Phaser aus fundsp.

use fundsp::prelude32::*;
use serde::{Deserialize, Serialize};

use crate::audio::fund::Rebuilt;

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

/// Feste Teile eines Modulations-Graphen (Werte in Hundertsteln).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Shape {
    mode: ModulationMode,
    rate: u16,
    depth: u16,
    feedback: u16,
}

impl Shape {
    fn of(p: &ModulationParams) -> Self {
        let q = |v: f32| (v * 100.0).round() as u16;
        Self {
            mode: p.mode,
            rate: q(p.rate_hz),
            depth: q(p.depth),
            feedback: q(p.feedback),
        }
    }
}

/// Chorus, Flanger und Phaser von fundsp; alle enthalten das trockene Signal.
fn graph(shape: Shape) -> Box<dyn AudioUnit> {
    let rate = shape.rate as f32 / 100.0;
    let depth = shape.depth as f32 / 100.0;
    let feedback = shape.feedback as f32 / 100.0;
    match shape.mode {
        // Vier Kopien um 15 ms, bewegt von Rauschen statt Sinus: natürlicher.
        ModulationMode::Chorus => Box::new(chorus(7, 0.012, 0.002 + 0.008 * depth, rate)),
        ModulationMode::Flanger => {
            let min = 0.000_3;
            let max = min + 0.004_5 * depth.max(0.05);
            Box::new(flanger(feedback, min, max, move |t| {
                lerp11(min, max, sin_hz(rate, t))
            }))
        }
        ModulationMode::Phaser => {
            let depth = depth.max(0.05);
            Box::new(phaser(feedback, move |t| {
                0.5 + 0.5 * depth * sin_hz(rate, t)
            }))
        }
    }
}

/// Modulation aus fundsp: Art, Tempo, Tiefe und Rückkopplung bauen den Graphen
/// (weich übergeblendet), der Anteil mischt live.
pub struct Modulation {
    unit: Rebuilt<Shape>,
}

impl Default for Modulation {
    fn default() -> Self {
        Self::new()
    }
}

impl Modulation {
    pub fn new() -> Self {
        Self {
            unit: Rebuilt::new(Shape::of(&ModulationParams::default()), graph),
        }
    }

    pub fn process(&mut self, buf: &mut [f32], p: &ModulationParams) {
        self.unit.want(Shape::of(p));
        for s in buf.iter_mut() {
            let x = *s;
            let y = self.unit.tick(x);
            *s = x * (1.0 - p.mix) + y * p.mix;
        }
    }

    /// Frisch eingeschaltet: gleich mit den aktuellen Werten, ohne Überblendung.
    pub fn clear(&mut self, p: &ModulationParams) {
        self.unit.set_now(Shape::of(p));
        self.unit.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

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
            m.clear(&p);
            let mut buf: Vec<f32> = (0..48_000)
                .map(|i| (i as f32 * TAU * 220.0 / 48_000.0).sin() * 0.5)
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
