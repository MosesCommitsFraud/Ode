//! Der Drei-Band-EQ (Tiefen, Präsenz, Höhen) mit optionalem Low- und
//! High-Cut, gebaut aus den State-Variable-Filtern von fundsp. Dieselben
//! Filter liefern über `response` den exakten Frequenzgang für die Anzeige.

use fundsp::prelude32::*;
use serde::Deserialize;

use super::ENGINE_RATE;
use super::fund::{Fixed, unit};

/// Mitten und Güten der drei Bänder.
const LOW: (f32, f32) = (120.0, 0.707);
const MID: (f32, f32) = (2_500.0, 0.9);
const HIGH: (f32, f32) = (8_000.0, 0.707);
const CUT_Q: f32 = 0.707;
/// Ab hier gilt ein Low-Cut als aus, bis hier ein High-Cut.
pub const LOW_CUT_OFF: f32 = 20.0;
pub const HIGH_CUT_OFF: f32 = 20_000.0;

/// Einstellung, wie sie die Oberfläche für die Kurve schickt.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqCurve {
    pub low_db: f32,
    pub mid_db: f32,
    pub high_db: f32,
    pub low_cut_hz: Option<f32>,
    pub high_cut_hz: Option<f32>,
}

/// Drei Bänder, live über `Shared` (Verstärkung als Faktor).
pub struct Eq3 {
    low: Shared,
    mid: Shared,
    high: Shared,
    bands: Fixed,
    low_cut_hz: Shared,
    high_cut_hz: Shared,
    low_cut: Fixed,
    high_cut: Fixed,
    cuts: (bool, bool),
}

impl Default for Eq3 {
    fn default() -> Self {
        Self::new()
    }
}

impl Eq3 {
    pub fn new() -> Self {
        let (low, mid, high) = (shared(1.0), shared(1.0), shared(1.0));
        let bands = Fixed::new(Box::new(
            (pass() | dc(LOW) | var(&low))
                >> lowshelf()
                >> (pass() | dc(MID) | var(&mid))
                >> bell()
                >> (pass() | dc(HIGH) | var(&high))
                >> highshelf(),
        ));
        let (low_cut_hz, high_cut_hz) = (shared(LOW_CUT_OFF), shared(HIGH_CUT_OFF));
        let low_cut = Fixed::new(Box::new(
            (pass() | var(&low_cut_hz) | dc(CUT_Q)) >> highpass(),
        ));
        let high_cut = Fixed::new(Box::new(
            (pass() | var(&high_cut_hz) | dc(CUT_Q)) >> lowpass(),
        ));
        Self {
            low,
            mid,
            high,
            bands,
            low_cut_hz,
            high_cut_hz,
            low_cut,
            high_cut,
            cuts: (false, false),
        }
    }

    pub fn set(&mut self, low_db: f32, mid_db: f32, high_db: f32) {
        self.low.set_value(db_amp(low_db));
        self.mid.set_value(db_amp(mid_db));
        self.high.set_value(db_amp(high_db));
    }

    /// Low- und High-Cut; außerhalb der Grenzen sind sie ganz aus dem Weg.
    pub fn set_cuts(&mut self, low_cut_hz: f32, high_cut_hz: f32) {
        let cuts = (low_cut_hz > LOW_CUT_OFF, high_cut_hz < HIGH_CUT_OFF);
        if cuts.0 && !self.cuts.0 {
            self.low_cut.reset();
        }
        if cuts.1 && !self.cuts.1 {
            self.high_cut.reset();
        }
        self.cuts = cuts;
        self.low_cut_hz.set_value(low_cut_hz);
        self.high_cut_hz.set_value(high_cut_hz);
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
pub fn response(curve: &EqCurve, freqs: &[f64]) -> Vec<f32> {
    let bands = lowshelf_hz(LOW.0, LOW.1, db_amp(curve.low_db))
        >> bell_hz(MID.0, MID.1, db_amp(curve.mid_db))
        >> highshelf_hz(HIGH.0, HIGH.1, db_amp(curve.high_db));
    let mut graph: Box<dyn AudioUnit> = Box::new(bands);
    if let Some(hz) = curve.low_cut_hz.filter(|&hz| hz > LOW_CUT_OFF) {
        graph = Box::new(Net::wrap(graph) >> Net::wrap(Box::new(highpass_hz(hz, CUT_Q))));
    }
    if let Some(hz) = curve.high_cut_hz.filter(|&hz| hz < HIGH_CUT_OFF) {
        graph = Box::new(Net::wrap(graph) >> Net::wrap(Box::new(lowpass_hz(hz, CUT_Q))));
    }
    let mut graph = unit(graph);
    graph.set_sample_rate(ENGINE_RATE as f64);
    freqs
        .iter()
        .map(|&f| graph.response_db(0, f).unwrap_or(0.0) as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_gain(eq: &mut Eq3, freq: f32) -> f32 {
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
        let mut eq = Eq3::new();
        eq.set(6.0, -4.0, 3.0);
        let curve = EqCurve {
            low_db: 6.0,
            mid_db: -4.0,
            high_db: 3.0,
            low_cut_hz: None,
            high_cut_hz: None,
        };
        for f in [60.0, 2_500.0, 12_000.0] {
            let measured = sine_gain(&mut eq, f);
            let drawn = response(&curve, &[f as f64])[0];
            assert!(
                (measured - drawn).abs() < 0.3,
                "{f} Hz: gemessen {measured}, gezeichnet {drawn}"
            );
        }
    }

    #[test]
    fn flat_is_transparent() {
        let curve = EqCurve {
            low_db: 0.0,
            mid_db: 0.0,
            high_db: 0.0,
            low_cut_hz: Some(20.0),
            high_cut_hz: Some(20_000.0),
        };
        assert!(
            response(&curve, &[50.0, 1_000.0, 15_000.0])
                .iter()
                .all(|db| db.abs() < 0.01)
        );
    }
}
