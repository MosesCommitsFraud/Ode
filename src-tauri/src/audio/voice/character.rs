//! Klangcharakter aus fundsp: Roboter (Ringmodulator), Radio, Telefon,
//! Megafon, Verzerrung, Bitcrusher und Lo-Fi (Kassette). Jeder Modus hat zwei Regler, `amount` (wie
//! stark) und `tone` (Farbe), deren Bedeutung der Modus festlegt.

use fundsp::prelude32::*;
use serde::{Deserialize, Serialize};

use crate::audio::ENGINE_RATE;
use crate::audio::fund::Rebuilt;

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

/// Feste Teile eines Charakter-Graphen (Werte in Hundertsteln).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Voice {
    mode: CharacterMode,
    amount: u16,
    tone: u16,
}

impl Voice {
    fn of(p: &CharacterParams) -> Self {
        Self {
            mode: p.mode,
            amount: (p.amount * 100.0).round() as u16,
            tone: (p.tone * 100.0).round() as u16,
        }
    }
}

/// Jeder Modus als fundsp-Graph aus Filtern, Sättigung, Ringmodulator,
/// Sample-and-Hold und Rauschen; Ausgabe ist das bearbeitete Signal.
fn graph(v: Voice) -> Box<dyn AudioUnit> {
    let a = v.amount as f32 / 100.0;
    let t = v.tone as f32 / 100.0;
    match v.mode {
        CharacterMode::Robot => {
            let carrier = CharacterParams {
                tone: t,
                ..Default::default()
            }
            .robot_hz();
            // Ringmodulator plus kurzer Kamm bei 6 ms für den metallischen Klang.
            let ring = ((pass() * sine_hz(carrier)) >> mul(0.5 + a * 0.5)) & mul((1.0 - a) * 0.5);
            let comb = pass() & (feedback(delay(0.006) >> mul(0.55 * a)) >> mul(0.6 * a));
            Box::new(ring >> comb >> mul(1.4))
        }
        CharacterMode::Radio => {
            let center = 800.0 * 2f32.powf(t * 2.0);
            let drive = 1.0 + a * 8.0;
            Box::new(
                (highpass_hz(center * 0.4, 0.8)
                    >> lowpass_hz(center * 3.0, 0.9)
                    >> bell_hz(center, 1.2, db_amp(4.0))
                    >> shape(Tanh(drive))
                    >> mul(1.0 / drive.sqrt()))
                    + (noise() >> mul(0.004 * a)),
            )
        }
        CharacterMode::Telephone => {
            let narrow = 1.0 - t * 0.5;
            // Abtasten mit 8 kHz, Stufen mit 6–12 Bit.
            let steps = 2f32.powf(12.0 - a * 6.0);
            Box::new(
                highpass_hz(300.0 / narrow, 0.9)
                    >> lowpass_hz(3_400.0 * narrow, 0.9)
                    >> highpass_hz(300.0 / narrow, 0.9)
                    >> (pass() | dc(8_000.0))
                    >> hold(0.0)
                    >> shape(Crush(steps))
                    >> shape(Tanh(1.0 + a * 3.0))
                    >> mul(1.2),
            )
        }
        CharacterMode::Megaphone => {
            let drive = 2.0 + a * 14.0;
            Box::new(
                highpass_hz(650.0, 0.9)
                    >> bell_hz(1_800.0, 2.0, db_amp(4.0 + t * 10.0))
                    >> shape(Tanh(drive))
                    >> mul(0.7)
                    >> lowpass_hz(4_500.0, 0.8),
            )
        }
        CharacterMode::Distortion => {
            let drive = 1.0 + a * 40.0;
            // Leicht unsymmetrisch für mehr gerade Obertöne.
            Box::new(
                highpass_hz(80.0, 0.7)
                    >> (pass() + dc(0.1 / drive))
                    >> shape(Tanh(drive))
                    >> (pass() - dc(0.1f32.tanh()))
                    >> lowpass_hz(1_000.0 * 12f32.powf(t), 0.7)
                    >> mul(1.0 / (1.0 + a * 1.5)),
            )
        }
        CharacterMode::Bitcrusher => {
            let factor = 1.0 + (t * t * 31.0).floor();
            let bits = 16.0 - a * 14.0;
            Box::new(
                (pass() | dc(ENGINE_RATE as f32 / factor))
                    >> hold(0.0)
                    >> shape(Crush(2f32.powf(bits - 1.0))),
            )
        }
        CharacterMode::Lofi => {
            // Leiern (0,5 Hz) und Flattern (6 Hz) über eine gleitende Verzögerung.
            let wobble = move |time: f32| {
                let samples = 160.0
                    + (std::f32::consts::TAU * 0.5 * time).sin() * 30.0 * a
                    + (std::f32::consts::TAU * 6.0 * time).sin() * 3.0 * a;
                samples / ENGINE_RATE as f32
            };
            let warmth = 1.8f32;
            Box::new(
                (((pass() | lfo(wobble))
                    >> tap(0.001, 0.01)
                    >> highpass_hz(180.0, 0.7)
                    >> lowpass_hz(2_000.0 * 3f32.powf(t), 0.6)
                    >> bell_hz(400.0, 0.8, db_amp(2.5))
                    >> shape(Tanh(warmth))
                    >> mul(1.0 / warmth.tanh()))
                    + (pink() >> mul(0.012 * a)))
                    >> shape(Crush(2_048.0))
                    >> mul(1.1),
            )
        }
    }
}

/// Klangcharakter aus fundsp: Modus, Stärke und Farbe bauen den Graphen
/// (weich übergeblendet), der Anteil mischt live.
pub struct Character {
    params: CharacterParams,
    unit: Rebuilt<Voice>,
}

impl Default for Character {
    fn default() -> Self {
        Self::new()
    }
}

impl Character {
    pub fn new() -> Self {
        let p = CharacterParams::default();
        Self {
            params: p,
            unit: Rebuilt::new(Voice::of(&p), graph),
        }
    }

    pub fn configure(&mut self, p: &CharacterParams) {
        // Neuer Modus klingt ganz anders: sofort wechseln statt langsam überblenden.
        if p.mode != self.params.mode {
            self.unit.set_now(Voice::of(p));
        } else {
            self.unit.want(Voice::of(p));
        }
        self.params = *p;
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        let mix = self.params.mix;
        for s in buf.iter_mut() {
            let x = *s;
            let wet = self.unit.tick(x);
            *s = x * (1.0 - mix) + wet * mix;
        }
    }

    pub fn clear(&mut self) {
        self.unit.set_now(Voice::of(&self.params));
        self.unit.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    const RATE: f32 = ENGINE_RATE as f32;

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
