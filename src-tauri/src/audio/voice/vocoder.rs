//! Kanal-Vocoder aus fundsp-Bausteinen: Die Stimme steuert in 16 Bändern die Lautstärke eines
//! Synthesizer-Trägers (Sägezahn-Akkord mit etwas Rauschen). Der Träger
//! spielt eine feste Note oder folgt der erkannten Tonhöhe.

use serde::{Deserialize, Serialize};

use fundsp::prelude32::{Shared, afollow, bandpass_hz, mul, shared, var};

use super::pitch::hz_of;
use crate::audio::fund::Fixed;
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

pub fn band_frequency(i: usize) -> f32 {
    LOWEST * (HIGHEST / LOWEST).powf(i as f32 / (BANDS - 1) as f32)
}

/// Kanal-Vocoder aus fundsp-Bausteinen: Bandpässe für Stimme und Träger,
/// Hüllkurvenfolger je Band und bandbegrenzte Sägezähne als Träger.
pub struct Vocoder {
    analysis: Vec<Fixed>,
    followers: Vec<Fixed>,
    synthesis: Vec<Fixed>,
    carrier: Fixed,
    /// Frequenz und Pegel der drei Sägezähne, Anteil Säge und Rauschen.
    freqs: [Shared; 3],
    gains: [Shared; 3],
    saw: Shared,
    noise: Shared,
    /// Geglättete Grundfrequenz, damit Notenwechsel nicht knacken.
    freq: f32,
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
        // fundsps Bandpass verstärkt in der Mitte um Q; normiert auf 0 dB wie zuvor.
        let band = |i| Fixed::new(Box::new(bandpass_hz(band_frequency(i), Q) >> mul(1.0 / Q)));
        let freqs: [Shared; 3] = std::array::from_fn(|_| shared(hz_of(48.0)));
        let gains: [Shared; 3] = std::array::from_fn(|i| shared(if i == 0 { 1.0 } else { 0.0 }));
        let (saw, noise) = (shared(1.0), shared(0.0));
        let voice = |i: usize| (var(&freqs[i]) >> fundsp::prelude32::saw()) * var(&gains[i]);
        let carrier = Fixed::new(Box::new(
            (voice(0) + voice(1) + voice(2)) * var(&saw) + fundsp::prelude32::noise() * var(&noise),
        ));
        Self {
            analysis: (0..BANDS).map(band).collect(),
            followers: (0..BANDS)
                .map(|_| Fixed::new(Box::new(afollow(0.003f32, 0.03f32))))
                .collect(),
            synthesis: (0..BANDS).map(band).collect(),
            carrier,
            freqs,
            gains,
            saw,
            noise,
            freq: hz_of(48.0),
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
        let level = 1.0 / (intervals.len() as f32).sqrt();
        for (i, gain) in self.gains.iter().enumerate() {
            gain.set_value(if i < intervals.len() { level } else { 0.0 });
        }
        self.saw.set_value(1.0 - p.breath * 0.5);
        self.noise.set_value(p.breath);
        for s in buf.iter_mut() {
            let x = *s;
            self.freq += (target - self.freq) * 0.002;
            for (shared, &interval) in self.freqs.iter().zip(intervals) {
                shared.set_value(self.freq * 2f32.powf(interval / 12.0));
            }
            let carrier = self.carrier.generate();
            let mut out = 0.0;
            for b in 0..BANDS {
                let envelope = self.followers[b].tick(self.analysis[b].tick(x).abs());
                self.levels[b] = self.levels[b].max(envelope);
                out += self.synthesis[b].tick(carrier) * envelope;
            }
            *s = x * (1.0 - p.mix) + out * 4.0 * p.mix;
        }
    }

    pub fn take_levels(&mut self) -> [f32; BANDS] {
        std::mem::replace(&mut self.levels, [0.0; BANDS])
    }

    pub fn clear(&mut self) {
        self.analysis.iter_mut().for_each(Fixed::reset);
        self.followers.iter_mut().for_each(Fixed::reset);
        self.synthesis.iter_mut().for_each(Fixed::reset);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = crate::audio::ENGINE_RATE as f32;

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
