//! Parametrischer EQ: ein Tiefen-Kuhschwanz, drei Glocken und ein
//! Höhen-Kuhschwanz, jeweils mit Frequenz, Verstärkung und Güte, dazu
//! Low- und High-Cut. Gebaut aus den State-Variable-Filtern von fundsp;
//! dieselben Filter liefern über `response` den exakten Frequenzgang.

use fundsp::prelude32::*;
use serde::{Deserialize, Serialize};

use super::ENGINE_RATE;
use super::fund::{Fixed, unit};

pub const BANDS: usize = 5;
const CUT_Q: f32 = 0.707;
/// Ab hier gilt ein Low-Cut als aus, bis hier ein High-Cut.
pub const LOW_CUT_OFF: f32 = 20.0;
pub const HIGH_CUT_OFF: f32 = 20_000.0;
pub const GAIN_LIMIT_DB: f32 = 15.0;

/// Form eines Bands: das erste und das letzte sind Kuhschwänze.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Shape {
    LowShelf,
    Bell,
    HighShelf,
}

fn shape(band: usize) -> Shape {
    match band {
        0 => Shape::LowShelf,
        b if b == BANDS - 1 => Shape::HighShelf,
        _ => Shape::Bell,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqBand {
    pub freq_hz: f32,
    pub gain_db: f32,
    pub q: f32,
}

impl Default for EqBand {
    fn default() -> Self {
        Self {
            freq_hz: 1_000.0,
            gain_db: 0.0,
            q: 1.0,
        }
    }
}

/// Einstellung eines EQs, gleich für Mikrofon und Kanäle.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqSettings {
    pub bands: [EqBand; BANDS],
    pub low_cut_hz: f32,
    pub high_cut_hz: f32,
}

impl Default for EqSettings {
    fn default() -> Self {
        let band = |freq_hz, q| EqBand {
            freq_hz,
            gain_db: 0.0,
            q,
        };
        Self {
            bands: [
                band(100.0, 0.707),
                band(300.0, 1.0),
                band(1_000.0, 1.0),
                band(3_000.0, 1.0),
                band(10_000.0, 0.707),
            ],
            low_cut_hz: LOW_CUT_OFF,
            high_cut_hz: HIGH_CUT_OFF,
        }
    }
}

impl EqSettings {
    pub fn clamped(mut self) -> Self {
        for (i, b) in self.bands.iter_mut().enumerate() {
            b.freq_hz = b.freq_hz.clamp(20.0, 20_000.0);
            b.gain_db = b.gain_db.clamp(-GAIN_LIMIT_DB, GAIN_LIMIT_DB);
            let max_q = if shape(i) == Shape::Bell { 10.0 } else { 2.0 };
            b.q = b.q.clamp(0.3, max_q);
        }
        self.low_cut_hz = self.low_cut_hz.clamp(LOW_CUT_OFF, 2_000.0);
        self.high_cut_hz = self.high_cut_hz.clamp(1_000.0, HIGH_CUT_OFF);
        self
    }
}

/// Live-Werte eines Bands (Frequenz, Güte, Verstärkung als Faktor).
struct BandVars {
    freq: Shared,
    q: Shared,
    gain: Shared,
}

/// Der EQ im Audio-Thread, live über `Shared`.
pub struct ParamEq {
    vars: Vec<BandVars>,
    bands: Fixed,
    low_cut_hz: Shared,
    high_cut_hz: Shared,
    low_cut: Fixed,
    high_cut: Fixed,
    cuts: (bool, bool),
}

impl Default for ParamEq {
    fn default() -> Self {
        Self::new()
    }
}

impl ParamEq {
    pub fn new() -> Self {
        let defaults = EqSettings::default();
        let vars: Vec<BandVars> = defaults
            .bands
            .iter()
            .map(|b| BandVars {
                freq: shared(b.freq_hz),
                q: shared(b.q),
                gain: shared(1.0),
            })
            .collect();
        let mut chain = Net::wrap(Box::new(pass()));
        for (i, v) in vars.iter().enumerate() {
            let inputs = pass() | var(&v.freq) | var(&v.q) | var(&v.gain);
            let band: Box<dyn AudioUnit> = match shape(i) {
                Shape::LowShelf => Box::new(inputs >> lowshelf()),
                Shape::Bell => Box::new(inputs >> bell()),
                Shape::HighShelf => Box::new(inputs >> highshelf()),
            };
            chain = chain >> Net::wrap(band);
        }
        let (low_cut_hz, high_cut_hz) = (shared(LOW_CUT_OFF), shared(HIGH_CUT_OFF));
        let low_cut = Fixed::new(Box::new(
            (pass() | var(&low_cut_hz) | dc(CUT_Q)) >> highpass(),
        ));
        let high_cut = Fixed::new(Box::new(
            (pass() | var(&high_cut_hz) | dc(CUT_Q)) >> lowpass(),
        ));
        Self {
            vars,
            bands: Fixed::new(Box::new(chain)),
            low_cut_hz,
            high_cut_hz,
            low_cut,
            high_cut,
            cuts: (false, false),
        }
    }

    pub fn set(&mut self, s: &EqSettings) {
        for (v, b) in self.vars.iter().zip(&s.bands) {
            v.freq.set_value(b.freq_hz);
            v.q.set_value(b.q);
            v.gain.set_value(db_amp(b.gain_db));
        }
        // Außerhalb der Grenzen sind die Cuts ganz aus dem Weg.
        let cuts = (s.low_cut_hz > LOW_CUT_OFF, s.high_cut_hz < HIGH_CUT_OFF);
        if cuts.0 && !self.cuts.0 {
            self.low_cut.reset();
        }
        if cuts.1 && !self.cuts.1 {
            self.high_cut.reset();
        }
        self.cuts = cuts;
        self.low_cut_hz.set_value(s.low_cut_hz);
        self.high_cut_hz.set_value(s.high_cut_hz);
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let mut y = self.bands.tick(x);
        if self.cuts.0 {
            y = self.low_cut.tick(y);
        }
        if self.cuts.1 {
            y = self.high_cut.tick(y);
        }
        y
    }

    pub fn reset(&mut self) {
        self.bands.reset();
        self.low_cut.reset();
        self.high_cut.reset();
    }
}

/// Exakter Frequenzgang in dB an den Frequenzen `freqs`, aus denselben
/// fundsp-Filtern mit festen Werten.
pub fn response(s: &EqSettings, freqs: &[f64]) -> Vec<f32> {
    let s = s.clamped();
    let mut chain = Net::wrap(Box::new(pass()));
    for (i, b) in s.bands.iter().enumerate() {
        let (f, q, g) = (b.freq_hz, b.q, db_amp(b.gain_db));
        let band: Box<dyn AudioUnit> = match shape(i) {
            Shape::LowShelf => Box::new(lowshelf_hz(f, q, g)),
            Shape::Bell => Box::new(bell_hz(f, q, g)),
            Shape::HighShelf => Box::new(highshelf_hz(f, q, g)),
        };
        chain = chain >> Net::wrap(band);
    }
    if s.low_cut_hz > LOW_CUT_OFF {
        chain = chain >> Net::wrap(Box::new(highpass_hz(s.low_cut_hz, CUT_Q)));
    }
    if s.high_cut_hz < HIGH_CUT_OFF {
        chain = chain >> Net::wrap(Box::new(lowpass_hz(s.high_cut_hz, CUT_Q)));
    }
    let mut graph = unit(Box::new(chain));
    graph.set_sample_rate(ENGINE_RATE as f64);
    freqs
        .iter()
        .map(|&f| graph.response_db(0, f).unwrap_or(0.0) as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_gain(eq: &mut ParamEq, freq: f32) -> f32 {
        eq.reset();
        let mut peak = 0.0f32;
        for i in 0..48_000 {
            let y = eq.tick((i as f32 * std::f32::consts::TAU * freq / 48_000.0).sin());
            if i > 24_000 {
                peak = peak.max(y.abs());
            }
        }
        amp_db(peak)
    }

    #[test]
    fn processing_matches_the_drawn_curve() {
        let mut s = EqSettings::default();
        s.bands[0].gain_db = 6.0;
        s.bands[2] = EqBand {
            freq_hz: 800.0,
            gain_db: -8.0,
            q: 4.0,
        };
        s.bands[3].gain_db = 4.0;
        s.bands[4].gain_db = 3.0;
        s.low_cut_hz = 40.0;
        s.high_cut_hz = 16_000.0;
        let mut eq = ParamEq::new();
        eq.set(&s);
        for f in [60.0, 800.0, 3_000.0, 11_000.0] {
            let measured = sine_gain(&mut eq, f);
            let drawn = response(&s, &[f as f64])[0];
            assert!(
                (measured - drawn).abs() < 0.3,
                "{f} Hz: gemessen {measured}, gezeichnet {drawn}"
            );
        }
    }

    #[test]
    fn flat_is_transparent() {
        let curve = response(&EqSettings::default(), &[50.0, 1_000.0, 15_000.0]);
        assert!(curve.iter().all(|db| db.abs() < 0.01), "{curve:?}");
    }
}
