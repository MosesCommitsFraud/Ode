//! Parametrischer EQ mit frei gesetzten Bändern: bis zu `SLOTS` Stück, jedes
//! mit eigener Form (Glocke, Kuhschwanz, Low- oder High-Cut), Frequenz,
//! Verstärkung und Güte. Gebaut aus den State-Variable-Filtern von fundsp;
//! dieselben Filter liefern über `response` den exakten Frequenzgang.

use fundsp::prelude32::*;
use serde::{Deserialize, Deserializer, Serialize};

use super::ENGINE_RATE;
use super::fund::{Fixed, unit};

/// Höchstzahl der Bänder; die Oberfläche schaltet Plätze an und aus.
pub const SLOTS: usize = 8;
pub const GAIN_LIMIT_DB: f32 = 15.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BandShape {
    #[default]
    Bell,
    LowShelf,
    HighShelf,
    LowCut,
    HighCut,
}

const SHAPES: [BandShape; 5] = [
    BandShape::Bell,
    BandShape::LowShelf,
    BandShape::HighShelf,
    BandShape::LowCut,
    BandShape::HighCut,
];

impl BandShape {
    fn index(self) -> usize {
        SHAPES.iter().position(|&s| s == self).unwrap_or(0)
    }

    fn max_q(self) -> f32 {
        if self == BandShape::Bell { 10.0 } else { 2.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqBand {
    pub enabled: bool,
    pub shape: BandShape,
    pub freq_hz: f32,
    /// Bei Cuts ohne Wirkung.
    pub gain_db: f32,
    pub q: f32,
}

impl Default for EqBand {
    fn default() -> Self {
        Self {
            enabled: false,
            shape: BandShape::Bell,
            freq_hz: 1_000.0,
            gain_db: 0.0,
            q: 1.0,
        }
    }
}

/// Einstellung eines EQs, gleich für Mikrofon und Kanäle.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EqSettings {
    #[serde(deserialize_with = "slots")]
    pub bands: [EqBand; SLOTS],
}

/// Beliebig viele Bänder lesen und auf `SLOTS` Plätze bringen.
fn slots<'de, D: Deserializer<'de>>(d: D) -> Result<[EqBand; SLOTS], D::Error> {
    let list = Vec::<EqBand>::deserialize(d)?;
    let mut out = [EqBand::default(); SLOTS];
    for (slot, band) in out.iter_mut().zip(list) {
        *slot = band;
    }
    Ok(out)
}

impl EqSettings {
    pub fn clamped(mut self) -> Self {
        for b in &mut self.bands {
            b.freq_hz = b.freq_hz.clamp(20.0, 20_000.0);
            b.gain_db = b.gain_db.clamp(-GAIN_LIMIT_DB, GAIN_LIMIT_DB);
            b.q = b.q.clamp(0.3, b.shape.max_q());
        }
        self
    }
}

/// Live-Werte eines Platzes (Frequenz, Güte, Verstärkung als Faktor).
struct Slot {
    freq: Shared,
    q: Shared,
    gain: Shared,
    /// Ein Filter je Form, alle an denselben Werten; nur der aktive rechnet.
    units: Vec<Fixed>,
    active: Option<BandShape>,
}

impl Slot {
    fn new() -> Self {
        let (freq, q, gain) = (shared(1_000.0), shared(1.0), shared(1.0));
        let units = SHAPES
            .iter()
            .map(|&shape| {
                let three = || pass() | var(&freq) | var(&q) | var(&gain);
                let two = || pass() | var(&freq) | var(&q);
                let node: Box<dyn AudioUnit> = match shape {
                    BandShape::Bell => Box::new(three() >> bell()),
                    BandShape::LowShelf => Box::new(three() >> lowshelf()),
                    BandShape::HighShelf => Box::new(three() >> highshelf()),
                    BandShape::LowCut => Box::new(two() >> highpass()),
                    BandShape::HighCut => Box::new(two() >> lowpass()),
                };
                Fixed::new(node)
            })
            .collect();
        Self {
            freq,
            q,
            gain,
            units,
            active: None,
        }
    }
}

/// Der EQ im Audio-Thread, live über `Shared`.
pub struct ParamEq {
    slots: Vec<Slot>,
}

impl Default for ParamEq {
    fn default() -> Self {
        Self::new()
    }
}

impl ParamEq {
    pub fn new() -> Self {
        Self {
            slots: (0..SLOTS).map(|_| Slot::new()).collect(),
        }
    }

    pub fn set(&mut self, s: &EqSettings) {
        for (slot, b) in self.slots.iter_mut().zip(&s.bands) {
            slot.freq.set_value(b.freq_hz);
            slot.q.set_value(b.q);
            slot.gain.set_value(db_amp(b.gain_db));
            let active = b.enabled.then_some(b.shape);
            // Neu eingeschaltet oder andere Form: ohne alten Zustand beginnen.
            if let Some(shape) = active
                && slot.active != active
            {
                slot.units[shape.index()].reset();
            }
            slot.active = active;
        }
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let mut y = x;
        for slot in &mut self.slots {
            if let Some(shape) = slot.active {
                y = slot.units[shape.index()].tick(y);
            }
        }
        y
    }

    pub fn reset(&mut self) {
        for slot in &mut self.slots {
            for unit in &mut slot.units {
                unit.reset();
            }
        }
    }
}

/// Exakter Frequenzgang in dB an den Frequenzen `freqs`, aus denselben
/// fundsp-Filtern mit festen Werten.
pub fn response(s: &EqSettings, freqs: &[f64]) -> Vec<f32> {
    let s = s.clamped();
    let mut chain = Net::wrap(Box::new(pass()));
    for b in s.bands.iter().filter(|b| b.enabled) {
        let (f, q, g) = (b.freq_hz, b.q, db_amp(b.gain_db));
        let band: Box<dyn AudioUnit> = match b.shape {
            BandShape::Bell => Box::new(bell_hz(f, q, g)),
            BandShape::LowShelf => Box::new(lowshelf_hz(f, q, g)),
            BandShape::HighShelf => Box::new(highshelf_hz(f, q, g)),
            BandShape::LowCut => Box::new(highpass_hz(f, q)),
            BandShape::HighCut => Box::new(lowpass_hz(f, q)),
        };
        chain = chain >> Net::wrap(band);
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

    fn band(shape: BandShape, freq_hz: f32, gain_db: f32, q: f32) -> EqBand {
        EqBand {
            enabled: true,
            shape,
            freq_hz,
            gain_db,
            q,
        }
    }

    #[test]
    fn processing_matches_the_drawn_curve() {
        let mut s = EqSettings::default();
        s.bands[0] = band(BandShape::LowShelf, 100.0, 6.0, 0.707);
        s.bands[3] = band(BandShape::Bell, 800.0, -8.0, 4.0);
        s.bands[4] = band(BandShape::HighShelf, 8_000.0, 3.0, 0.707);
        s.bands[6] = band(BandShape::LowCut, 40.0, 0.0, 0.707);
        s.bands[7] = band(BandShape::HighCut, 16_000.0, 0.0, 0.707);
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
    fn empty_is_transparent() {
        let curve = response(&EqSettings::default(), &[50.0, 1_000.0, 15_000.0]);
        assert!(curve.iter().all(|db| db.abs() < 0.01), "{curve:?}");
        let mut eq = ParamEq::new();
        eq.set(&EqSettings::default());
        assert_eq!(eq.tick(0.5), 0.5);
    }

    #[test]
    fn reads_fewer_bands() {
        let s: EqSettings =
            serde_json::from_str(r#"{"bands":[{"enabled":true,"shape":"lowCut","freqHz":80}]}"#)
                .unwrap();
        assert_eq!(s.bands[0].shape, BandShape::LowCut);
        assert!(!s.bands[1].enabled);
    }
}
