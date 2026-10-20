//! Tonhöhe erkennen (YIN) und verschieben (TD-PSOLA).
//!
//! Der Detektor arbeitet auf einer auf 12 kHz heruntergerechneten Kopie und
//! verfeinert das Ergebnis in voller Rate. Der Verschieber setzt pro
//! Grundperiode eine Marke ins Eingangssignal, schneidet dort Körner von zwei
//! Perioden Länge aus (Hann-Fenster) und legt sie im neuen Abstand wieder
//! übereinander. So bleiben die Formanten erhalten; liest man die Körner
//! gestaucht oder gedehnt, verschieben sich die Formanten unabhängig davon.

use std::collections::VecDeque;

use crate::audio::ENGINE_RATE;
use crate::audio::dsp::{Biquad, DelayLine, Shape};

const RATE: f32 = ENGINE_RATE as f32;

/// Tiefster und höchster erkannter Grundton.
pub const MIN_HZ: f32 = 70.0;
pub const MAX_HZ: f32 = 1_000.0;

const DECIMATE: usize = 4;
const DEC_RATE: f32 = RATE / DECIMATE as f32;
/// Integrationsfenster des YIN in heruntergerechneten Samples (25 ms).
const WINDOW: usize = 300;
const TAU_MIN: usize = (DEC_RATE / MAX_HZ) as usize;
const TAU_MAX: usize = (DEC_RATE / MIN_HZ) as usize + 2;
/// Fenster für die Verfeinerung in voller Rate.
const FINE_WINDOW: usize = 1024;
/// Alle so viele Samples wird neu geschätzt (5 ms).
const HOP: usize = 240;
/// Schwelle der normierten Differenzfunktion für „periodisch“.
const YIN_THRESHOLD: f32 = 0.15;
/// Darüber gilt ein Abschnitt nicht mehr als stimmhaft.
const VOICED_LIMIT: f32 = 0.3;
/// Mindestpegel (RMS) für eine Schätzung: etwa −50 dBFS.
const MIN_RMS: f32 = 0.003;

pub struct PitchDetector {
    lowpass: [Biquad; 2],
    phase: usize,
    decimated: DelayLine,
    full: DelayLine,
    since: usize,
    scratch: Vec<f32>,
    diff: Vec<f32>,
    /// Periode in Samples (volle Rate), 0 wenn stimmlos.
    period: f32,
    voiced: bool,
    /// Wie eindeutig die letzte Schätzung war, 0–1.
    pub clarity: f32,
}

impl Default for PitchDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl PitchDetector {
    pub fn new() -> Self {
        Self {
            lowpass: [
                Biquad::new(Shape::LowPass, 3_000.0, 0.54, 0.0),
                Biquad::new(Shape::LowPass, 3_000.0, 1.31, 0.0),
            ],
            phase: 0,
            decimated: DelayLine::new(1024),
            full: DelayLine::new(8192),
            since: 0,
            scratch: vec![0.0; FINE_WINDOW + TAU_MAX * DECIMATE + 16],
            diff: vec![0.0; TAU_MAX + 1],
            period: 0.0,
            voiced: false,
            clarity: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.decimated.clear();
        self.full.clear();
        self.lowpass.iter_mut().for_each(Biquad::reset);
        self.period = 0.0;
        self.voiced = false;
        self.clarity = 0.0;
    }

    /// Grundton in Hz, solange stimmhaft.
    pub fn frequency(&self) -> Option<f32> {
        self.voiced.then(|| RATE / self.period)
    }

    /// Periode in Samples, solange stimmhaft.
    pub fn period(&self) -> Option<f32> {
        self.voiced.then_some(self.period)
    }

    #[inline]
    pub fn push(&mut self, x: f32) {
        self.full.push(x);
        let mut y = x;
        for f in &mut self.lowpass {
            y = f.process(y);
        }
        self.phase += 1;
        if self.phase == DECIMATE {
            self.phase = 0;
            self.decimated.push(y);
        }
        self.since += 1;
        if self.since >= HOP {
            self.since = 0;
            self.estimate();
        }
    }

    fn estimate(&mut self) {
        let len = WINDOW + TAU_MAX;
        // Älteste zuerst.
        for (i, s) in self.scratch[..len].iter_mut().enumerate() {
            *s = self.decimated.tap(len - 1 - i);
        }
        let x = &self.scratch[..len];
        let rms = (x[TAU_MAX..].iter().map(|s| s * s).sum::<f32>() / WINDOW as f32).sqrt();
        if rms < MIN_RMS {
            self.voiced = false;
            self.clarity = 0.0;
            return;
        }

        // Differenzfunktion und kumulativ normierte Variante (YIN, Schritt 2–3).
        self.diff[0] = 1.0;
        let mut running = 0.0f32;
        for tau in 1..=TAU_MAX {
            let mut d = 0.0f32;
            for j in 0..WINDOW {
                let delta = x[j] - x[j + tau];
                d += delta * delta;
            }
            running += d;
            self.diff[tau] = if running > 0.0 {
                d * tau as f32 / running
            } else {
                1.0
            };
        }

        // Erste Senke unter der Schwelle, sonst das globale Minimum.
        let mut best = None;
        let mut tau = TAU_MIN;
        while tau < TAU_MAX {
            if self.diff[tau] < YIN_THRESHOLD {
                while tau + 1 < TAU_MAX && self.diff[tau + 1] < self.diff[tau] {
                    tau += 1;
                }
                best = Some(tau);
                break;
            }
            tau += 1;
        }
        let best = best.unwrap_or_else(|| {
            (TAU_MIN..TAU_MAX)
                .min_by(|&a, &b| self.diff[a].total_cmp(&self.diff[b]))
                .unwrap_or(TAU_MIN)
        });
        let value = self.diff[best];
        self.clarity = (1.0 - value).clamp(0.0, 1.0);
        if value > VOICED_LIMIT {
            self.voiced = false;
            return;
        }
        let coarse = parabola(&self.diff, best) * DECIMATE as f32;
        self.period = self.refine(coarse);
        self.voiced = self.period > 0.0;
    }

    /// Sucht in voller Rate um die grobe Periode herum das genaue Minimum.
    fn refine(&mut self, coarse: f32) -> f32 {
        let lo = (coarse - DECIMATE as f32 - 1.0).max(2.0) as usize;
        let hi = (coarse + DECIMATE as f32 + 1.0) as usize;
        let len = FINE_WINDOW + hi + 1;
        if len > self.scratch.len() {
            return coarse;
        }
        for (i, s) in self.scratch[..len].iter_mut().enumerate() {
            *s = self.full.tap(len - 1 - i);
        }
        let x = &self.scratch[..len];
        let start = hi + 1;
        let mut d = [0.0f32; 2 * DECIMATE + 4];
        let count = hi - lo + 1;
        for (k, slot) in d.iter_mut().take(count).enumerate() {
            let tau = lo + k;
            *slot = (start..len)
                .map(|j| {
                    let delta = x[j] - x[j - tau];
                    delta * delta
                })
                .sum();
        }
        let k = (0..count)
            .min_by(|&a, &b| d[a].total_cmp(&d[b]))
            .unwrap_or(0);
        lo as f32 + parabola(&d[..count], k)
    }
}

/// Verfeinert ein Minimum per Parabel durch die Nachbarn.
fn parabola(values: &[f32], i: usize) -> f32 {
    if i == 0 || i + 1 >= values.len() {
        return i as f32;
    }
    let (a, b, c) = (values[i - 1], values[i], values[i + 1]);
    let denom = a - 2.0 * b + c;
    if denom.abs() < 1e-12 {
        i as f32
    } else {
        i as f32 + 0.5 * (a - c) / denom
    }
}

// ------------------------------------------------------------ Verschieber

/// Abstand der Marken in stimmlosen Abschnitten: 5 ms.
const UNVOICED_PERIOD: f32 = 240.0;
/// So weit vor dem Ausgabezeitpunkt werden Körner gelegt; zugleich die
/// halbe Länge des größten Korns.
const LOOKAHEAD: i64 = 640;
/// Verzögerung des Verschiebers: 25 ms.
pub const LATENCY: i64 = 1_200;
const RING: usize = 8192;

#[derive(Debug, Clone, Copy)]
pub struct Mark {
    pub pos: i64,
    pub period: f32,
    pub voiced: bool,
}

impl Mark {
    pub fn frequency(&self) -> f32 {
        RATE / self.period
    }
}

#[derive(Debug, Clone, Copy)]
struct SynthVoice {
    /// Eingangszeit der nächsten Synthese-Marke.
    next: f64,
    active: bool,
}

/// Eine Stimme des Verschiebers: Verhältnis der Tonhöhe, Formant-Faktor und
/// Lautstärke, für jedes Korn neu bestimmt.
#[derive(Debug, Clone, Copy)]
pub struct Grain {
    pub ratio: f32,
    pub formant: f32,
    pub level: f32,
}

pub struct Psola {
    input: Vec<f32>,
    acc: Vec<f32>,
    /// Anzahl geschriebener Samples = Eingangszeit des nächsten Samples.
    n: i64,
    marks: VecDeque<Mark>,
    last_mark: i64,
    voices: Vec<SynthVoice>,
}

impl Psola {
    pub fn new(voices: usize) -> Self {
        Self {
            input: vec![0.0; RING],
            acc: vec![0.0; RING],
            n: 0,
            marks: VecDeque::with_capacity(64),
            last_mark: -LATENCY,
            voices: vec![
                SynthVoice {
                    next: 0.0,
                    active: false,
                };
                voices
            ],
        }
    }

    pub fn reset(&mut self) {
        self.input.iter_mut().for_each(|s| *s = 0.0);
        self.acc.iter_mut().for_each(|s| *s = 0.0);
        self.marks.clear();
        self.last_mark = self.n - LATENCY;
        for v in &mut self.voices {
            v.active = false;
        }
    }

    #[inline]
    fn at(&self, t: i64) -> f32 {
        self.input[(t as usize) & (RING - 1)]
    }

    /// Linear interpoliert in Eingangszeit.
    #[inline]
    fn at_frac(&self, t: f64) -> f32 {
        let i = t.floor();
        let frac = (t - i) as f32;
        let a = self.at(i as i64);
        let b = self.at(i as i64 + 1);
        a + (b - a) * frac
    }

    /// Trockenes Signal mit derselben Verzögerung wie die Stimmen.
    #[inline]
    pub fn delayed(&self) -> f32 {
        self.at(self.n - 1 - LATENCY)
    }

    /// Nimmt ein Sample auf und setzt Marken nach; `period` ist die aktuelle
    /// Grundperiode, falls stimmhaft.
    #[inline]
    pub fn push(&mut self, x: f32, period: Option<f32>) {
        let i = (self.n as usize) & (RING - 1);
        self.input[i] = x;
        self.n += 1;

        let newest = self.n - 1;
        // Nach langer Pause wieder dicht an der Gegenwart ansetzen.
        if self.last_mark < newest - (RING as i64) / 2 {
            self.last_mark = newest - LATENCY;
        }
        loop {
            let (step, voiced) = match period {
                Some(p) => (p, true),
                None => (UNVOICED_PERIOD, false),
            };
            let search = if voiced { step * 0.25 } else { 0.0 };
            let predicted = self.last_mark + step.round() as i64;
            if predicted + search as i64 > newest {
                break;
            }
            let pos = if voiced {
                // Auf die größte Spitze um die Vorhersage einrasten.
                let lo = predicted - search as i64;
                let hi = predicted + search as i64;
                (lo..=hi)
                    .max_by(|&a, &b| self.at(a).total_cmp(&self.at(b)))
                    .unwrap_or(predicted)
            } else {
                predicted
            };
            self.marks.push_back(Mark {
                pos,
                period: step,
                voiced,
            });
            self.last_mark = pos;
        }
        let oldest = self.n - LATENCY - 3 * LOOKAHEAD;
        while self.marks.front().is_some_and(|m| m.pos < oldest) {
            self.marks.pop_front();
        }
    }

    /// Wählt die Marke nahe `s`, deren Korn schon vollständig vorliegt.
    fn pick(&self, s: f64, formant: f32) -> Option<Mark> {
        let newest = self.n - 1;
        let available = |m: &Mark| {
            let half = (m.period.min(LOOKAHEAD as f32) * formant.max(1.0)).ceil() as i64;
            m.pos + half <= newest
        };
        let mut best: Option<Mark> = None;
        for m in self.marks.iter().filter(|m| available(m)) {
            match best {
                Some(b) if (b.pos as f64 - s).abs() <= (m.pos as f64 - s).abs() => {}
                _ => best = Some(*m),
            }
        }
        best
    }

    /// Legt ein Korn der Marke `m` mittig bei `s` ab.
    fn place(&mut self, s: f64, m: &Mark, g: &Grain) {
        let half = m.period.min(LOOKAHEAD as f32);
        let h = half.round() as i64;
        if h < 2 {
            return;
        }
        let center = s.round() as i64;
        let ratio = if m.voiced { g.ratio.max(0.25) } else { 1.0 };
        // Dichter gelegte Körner überlappen stärker: ausgleichen.
        let gain = g.level / ratio;
        let inv = std::f32::consts::PI / half;
        for j in -h..=h {
            let w = 0.5 + 0.5 * (j as f32 * inv).cos();
            let x = self.at_frac(m.pos as f64 + j as f64 * g.formant as f64);
            let idx = ((center + j) as usize) & (RING - 1);
            self.acc[idx] += w * x * gain;
        }
    }

    /// Liefert das nächste Ausgangssample. `grain(stimme, marke)` bestimmt
    /// für jedes neue Korn Verhältnis, Formant und Lautstärke; `None` lässt
    /// die Stimme ruhen.
    pub fn next(&mut self, mut grain: impl FnMut(usize, &Mark) -> Option<Grain>) -> f32 {
        let p = self.n - 1 - LATENCY;
        for v in 0..self.voices.len() {
            let mut voice = self.voices[v];
            if !voice.active || voice.next < (p - LOOKAHEAD) as f64 {
                voice.next = p as f64 + LOOKAHEAD as f64;
                voice.active = true;
            }
            while voice.next <= (p + LOOKAHEAD) as f64 {
                let s = voice.next;
                let Some(m) = self.pick(s, 1.0) else {
                    voice.next += UNVOICED_PERIOD as f64;
                    continue;
                };
                let Some(g) = grain(v, &m) else {
                    voice.next += m.period as f64;
                    continue;
                };
                let m = self.pick(s, g.formant).unwrap_or(m);
                self.place(s, &m, &g);
                let ratio = if m.voiced { g.ratio.max(0.25) } else { 1.0 };
                voice.next += (m.period / ratio).max(16.0) as f64;
            }
            self.voices[v] = voice;
        }
        let idx = (p as usize) & (RING - 1);
        let y = self.acc[idx];
        self.acc[idx] = 0.0;
        y
    }
}

/// Midi-Notennummer (69 = A4 = 440 Hz) einer Frequenz.
pub fn note_of(hz: f32) -> f32 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

pub fn hz_of(note: f32) -> f32 {
    440.0 * 2f32.powf((note - 69.0) / 12.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    fn saw(freq: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| ((i as f32 * freq / RATE).fract() * 2.0 - 1.0) * 0.4)
            .collect()
    }

    fn sine(freq: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (i as f32 * TAU * freq / RATE).sin() * 0.4)
            .collect()
    }

    /// Mittlere erkannte Frequenz über die zweite Hälfte.
    fn detect(signal: &[f32]) -> f32 {
        let mut d = PitchDetector::new();
        let mut found = Vec::new();
        for (i, &x) in signal.iter().enumerate() {
            d.push(x);
            if i > signal.len() / 2 && i % HOP == 0 {
                found.push(d.frequency().unwrap_or(0.0));
            }
        }
        found.iter().sum::<f32>() / found.len() as f32
    }

    #[test]
    fn detects_sine_and_saw() {
        for f in [82.0, 110.0, 196.0, 261.6, 440.0, 700.0] {
            let s = detect(&sine(f, 24_000));
            assert!((s / f - 1.0).abs() < 0.005, "sine {f}: {s}");
            let w = detect(&saw(f, 24_000));
            assert!((w / f - 1.0).abs() < 0.005, "saw {f}: {w}");
        }
    }

    #[test]
    fn silence_is_unvoiced() {
        let mut d = PitchDetector::new();
        for _ in 0..4_800 {
            d.push(0.0);
        }
        assert!(d.frequency().is_none());
    }

    fn shift(signal: &[f32], ratio: f32, formant: f32) -> Vec<f32> {
        let mut d = PitchDetector::new();
        let mut p = Psola::new(1);
        signal
            .iter()
            .map(|&x| {
                d.push(x);
                p.push(x, d.period());
                p.next(|_, _| {
                    Some(Grain {
                        ratio,
                        formant,
                        level: 1.0,
                    })
                })
            })
            .collect()
    }

    #[test]
    fn shifts_an_octave_up_and_down() {
        for (f, ratio) in [(150.0, 2.0), (220.0, 2.0), (220.0, 0.5), (300.0, 1.5)] {
            let out = shift(&saw(f, 48_000), ratio, 1.0);
            let got = detect(&out);
            assert!((got / (f * ratio) - 1.0).abs() < 0.01, "{f}×{ratio}: {got}");
        }
    }

    #[test]
    fn unity_keeps_level_and_pitch() {
        let input = saw(180.0, 48_000);
        let out = shift(&input, 1.0, 1.0);
        let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
        let ratio = rms(&out[24_000..]) / rms(&input[24_000..]);
        assert!((ratio - 1.0).abs() < 0.15, "{ratio}");
        assert!((detect(&out) / 180.0 - 1.0).abs() < 0.01);
    }

    #[test]
    fn formant_shift_keeps_pitch() {
        let out = shift(&saw(160.0, 48_000), 1.0, 1.3);
        assert!((detect(&out) / 160.0 - 1.0).abs() < 0.02);
        assert!(out.iter().all(|s| s.is_finite() && s.abs() < 2.0));
    }

    #[test]
    fn notes_round_trip() {
        assert!((note_of(440.0) - 69.0).abs() < 1e-4);
        assert!((hz_of(60.0) - 261.63).abs() < 0.01);
    }
}
