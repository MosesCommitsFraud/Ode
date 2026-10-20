//! Spektrum für die Anzeige: Der Audio-Thread legt jeden Block in einen
//! Ringpuffer, ohne je zu warten; der Pegel-Thread rechnet daraus per FFT
//! logarithmisch verteilte Bänder in dB.

use std::fmt;
use std::sync::Arc;

use parking_lot::Mutex;
use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};

use super::ENGINE_RATE;

/// 4096 Punkte bei 48 kHz: ~12 Hz Auflösung, 85 ms Fenster.
pub const FFT_SIZE: usize = 4096;
/// Bänder von 20 Hz bis 20 kHz, gleichmäßig auf der logarithmischen Achse.
pub const BANDS: usize = 120;
pub const LOW_HZ: f32 = 20.0;
pub const HIGH_HZ: f32 = 20_000.0;
/// Untergrenze der Anzeige in dB.
pub const FLOOR_DB: f32 = -100.0;

/// Mitten der Bänder in Hz; dieselben Frequenzen nutzt die EQ-Kurve.
pub fn band_centers() -> Vec<f64> {
    let ratio = (HIGH_HZ as f64 / LOW_HZ as f64).powf(1.0 / BANDS as f64);
    (0..BANDS)
        .map(|i| LOW_HZ as f64 * ratio.powf(i as f64 + 0.5))
        .collect()
}

/// Die letzten `FFT_SIZE` Samples einer Stelle der Kette.
pub struct SpectrumTap {
    ring: Mutex<(Vec<f32>, usize)>,
}

impl Default for SpectrumTap {
    fn default() -> Self {
        Self {
            ring: Mutex::new((vec![0.0; FFT_SIZE], 0)),
        }
    }
}

impl fmt::Debug for SpectrumTap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SpectrumTap")
    }
}

impl SpectrumTap {
    /// Aus dem Audio-Thread: Ist der Puffer gerade gesperrt, fällt der Block aus.
    pub fn push(&self, block: &[f32]) {
        if let Some(mut guard) = self.ring.try_lock() {
            let (data, pos) = &mut *guard;
            for &s in block {
                data[*pos] = s;
                *pos = (*pos + 1) % FFT_SIZE;
            }
        }
    }

    /// Ältestes Sample zuerst.
    fn copy_into(&self, out: &mut [f32]) {
        let guard = self.ring.lock();
        let (data, pos) = &*guard;
        let (tail, head) = data.split_at(*pos);
        out[..head.len()].copy_from_slice(head);
        out[head.len()..].copy_from_slice(tail);
    }

    pub fn clear(&self) {
        let mut guard = self.ring.lock();
        guard.0.fill(0.0);
    }
}

/// Rechnet aus einem Abgriff die Bänder; hält die Werte, damit sie sanft fallen.
pub struct Analyzer {
    fft: Arc<dyn RealToComplex<f32>>,
    input: Vec<f32>,
    output: Vec<Complex<f32>>,
    window: Vec<f32>,
    /// Normierung, damit ein Sinus mit voller Aussteuerung 0 dB zeigt.
    scale: f32,
    held: Vec<f32>,
}

impl Analyzer {
    pub fn new() -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / FFT_SIZE as f32).cos())
            .collect();
        let scale = 2.0 / window.iter().sum::<f32>();
        Self {
            input: fft.make_input_vec(),
            output: fft.make_output_vec(),
            fft,
            window,
            scale,
            held: vec![FLOOR_DB; BANDS],
        }
    }

    /// Bänder in dB (`FLOOR_DB` … 0), von tief nach hoch.
    pub fn analyze(&mut self, tap: &SpectrumTap) -> Vec<f32> {
        tap.copy_into(&mut self.input);
        for (s, w) in self.input.iter_mut().zip(&self.window) {
            *s *= w;
        }
        if self.fft.process(&mut self.input, &mut self.output).is_err() {
            return self.held.clone();
        }
        let bin_hz = ENGINE_RATE as f32 / FFT_SIZE as f32;
        let magnitude =
            |bin: usize| self.output[bin.min(self.output.len() - 1)].norm() * self.scale;
        let ratio = (HIGH_HZ / LOW_HZ).powf(1.0 / BANDS as f32);
        for band in 0..BANDS {
            let lo = LOW_HZ * ratio.powi(band as i32);
            let hi = lo * ratio;
            let first = (lo / bin_hz).floor() as usize;
            let last = (hi / bin_hz).ceil() as usize;
            // Schmale tiefe Bänder liegen zwischen zwei Bins: dort interpolieren,
            // sonst das lauteste Bin im Band.
            let level = if last <= first + 1 {
                let center = (lo * hi).sqrt() / bin_hz;
                let i = center.floor() as usize;
                let t = center - i as f32;
                magnitude(i) * (1.0 - t) + magnitude(i + 1) * t
            } else {
                (first..last).map(magnitude).fold(0.0, f32::max)
            };
            let db = (20.0 * level.max(1e-9).log10()).max(FLOOR_DB);
            // Steigt sofort, fällt um höchstens 2 dB je Bild (30 Hz).
            self.held[band] = db.max(self.held[band] - 2.0);
        }
        self.held.clone()
    }
}

impl Default for Analyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_peaks_in_its_band_at_full_scale() {
        let tap = SpectrumTap::default();
        let freq = 1_000.0;
        let block: Vec<f32> = (0..FFT_SIZE)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / ENGINE_RATE as f32).sin())
            .collect();
        tap.push(&block);
        let bands = Analyzer::new().analyze(&tap);
        let ratio = (HIGH_HZ / LOW_HZ).powf(1.0 / BANDS as f32);
        let band = ((freq / LOW_HZ).ln() / ratio.ln()).floor() as usize;
        assert!(bands[band] > -1.5 && bands[band] < 0.5, "{}", bands[band]);
        assert!(bands[10] < -60.0);
    }
}
