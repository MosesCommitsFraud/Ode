//! Tonhöhe und Formanten mit Signalsmith Stretch (MIT, `vendor/`), einem
//! spektralen Verfahren: klingt bei Sprache und Gesang deutlich sauberer als
//! Körner-Verfahren, besonders bei großen Sprüngen und mehreren Stimmen.
//! Ein Kanal, Engine-Rate, Ein- und Ausgang gleich lang.

use std::ffi::{c_float, c_int, c_void};

use crate::audio::ENGINE_RATE;

unsafe extern "C" {
    fn ode_stretch_new(block_samples: c_int, interval_samples: c_int) -> *mut c_void;
    fn ode_stretch_free(s: *mut c_void);
    fn ode_stretch_reset(s: *mut c_void);
    fn ode_stretch_latency(s: *const c_void) -> c_int;
    fn ode_stretch_set_transpose(s: *mut c_void, factor: c_float, tonality_limit: c_float);
    fn ode_stretch_set_formant(s: *mut c_void, semitones: c_float, compensate: c_int);
    fn ode_stretch_set_formant_base(s: *mut c_void, relative_freq: c_float);
    fn ode_stretch_process(
        s: *mut c_void,
        input: *const c_float,
        output: *mut c_float,
        samples: c_int,
    );
}

/// Analysefenster: 40 ms. Kürzer klingt tiefe Stimmen rauer, länger
/// verzögert mehr. Die Verzögerung liegt etwa bei einem Fenster.
pub const BLOCK: usize = 1920;
/// Neue Analyse alle 5 ms: so schnell folgen Tonhöhenwechsel (Autotune).
pub const INTERVAL: usize = 240;
/// Oberhalb davon gilt der Klang als Rauschen (Zischlaute) und wird nicht
/// tonal verschoben; das vermeidet metallische S-Laute.
const TONALITY_LIMIT_HZ: f32 = 8_000.0;

pub struct Stretch {
    raw: *mut c_void,
    factor: f32,
}

// SAFETY: Jede Instanz gehört genau einem Thread zur Zeit; die Bibliothek
// hält keinen globalen Zustand.
unsafe impl Send for Stretch {}

impl Default for Stretch {
    fn default() -> Self {
        Self::new()
    }
}

impl Stretch {
    pub fn new() -> Self {
        // SAFETY: Erzeugt eine eigenständige Instanz; `Drop` gibt sie frei.
        let raw = unsafe { ode_stretch_new(BLOCK as c_int, INTERVAL as c_int) };
        assert!(
            !raw.is_null(),
            "Signalsmith Stretch konnte nicht angelegt werden"
        );
        let mut s = Self { raw, factor: 0.0 };
        s.set_transpose(1.0);
        s.set_formant(0.0, true);
        s
    }

    /// Verzögerung in Samples.
    pub fn latency(&self) -> usize {
        unsafe { ode_stretch_latency(self.raw) as usize }
    }

    pub fn reset(&mut self) {
        unsafe { ode_stretch_reset(self.raw) }
    }

    /// Tonhöhe als Faktor (2 = Oktave höher).
    pub fn set_transpose(&mut self, factor: f32) {
        let factor = factor.clamp(0.25, 4.0);
        if (factor - self.factor).abs() < 1e-5 {
            return;
        }
        self.factor = factor;
        unsafe {
            ode_stretch_set_transpose(self.raw, factor, TONALITY_LIMIT_HZ / ENGINE_RATE as f32)
        }
    }

    /// Formanten in Halbtönen; `keep` hält sie beim Transponieren an ihrem
    /// Platz, sodass `semitones` nur die Klangfarbe ändert.
    pub fn set_formant(&mut self, semitones: f32, keep: bool) {
        unsafe { ode_stretch_set_formant(self.raw, semitones, keep as c_int) }
    }

    /// Hinweis auf den Grundton für die Formant-Analyse; `None` = selbst schätzen.
    pub fn set_formant_base(&mut self, hz: Option<f32>) {
        let relative = hz.map_or(0.0, |hz| hz / ENGINE_RATE as f32);
        unsafe { ode_stretch_set_formant_base(self.raw, relative) }
    }

    pub fn process(&mut self, input: &[f32], output: &mut [f32]) {
        let n = input.len().min(output.len());
        if n == 0 {
            return;
        }
        // SAFETY: Beide Puffer haben mindestens `n` Samples.
        unsafe { ode_stretch_process(self.raw, input.as_ptr(), output.as_mut_ptr(), n as c_int) }
    }
}

impl Drop for Stretch {
    fn drop(&mut self) {
        unsafe { ode_stretch_free(self.raw) }
    }
}
