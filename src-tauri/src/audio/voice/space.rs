//! Raum und Zeit: Hall (Freeverb-Aufbau) und Echo. Beide arbeiten Sample für
//! Sample, damit sie auch als Effekt-Bus im Ausgang laufen können.

use serde::{Deserialize, Serialize};

use crate::audio::ENGINE_RATE;
use crate::audio::dsp::{Biquad, DelayLine, Shape};

const RATE: f32 = ENGINE_RATE as f32;

// ------------------------------------------------------------ Hall

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReverbParams {
    pub enabled: bool,
    /// Raumgröße 0–1: kleines Zimmer bis Kathedrale.
    pub size: f32,
    /// Höhendämpfung 0–1: wie weich der Raum klingt.
    pub damping: f32,
    /// Vorverzögerung in ms, bevor der Hall einsetzt.
    pub predelay_ms: f32,
    /// Bassanteil des Halls entfernen (Hz), damit es nicht mulmt.
    pub low_cut_hz: f32,
    /// Anteil des Halls 0–1.
    pub mix: f32,
}

impl Default for ReverbParams {
    fn default() -> Self {
        Self {
            enabled: false,
            size: 0.6,
            damping: 0.5,
            predelay_ms: 20.0,
            low_cut_hz: 200.0,
            mix: 0.25,
        }
    }
}

impl ReverbParams {
    pub fn clamped(mut self) -> Self {
        self.size = self.size.clamp(0.0, 1.0);
        self.damping = self.damping.clamp(0.0, 1.0);
        self.predelay_ms = self.predelay_ms.clamp(0.0, 200.0);
        self.low_cut_hz = self.low_cut_hz.clamp(20.0, 1000.0);
        self.mix = self.mix.clamp(0.0, 1.0);
        self
    }
}

/// Kammfilter mit gedämpfter Rückkopplung (Freeverb).
#[derive(Debug, Clone)]
struct Comb {
    line: Vec<f32>,
    pos: usize,
    store: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Self {
            line: vec![0.0; len],
            pos: 0,
            store: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32, feedback: f32, damp: f32) -> f32 {
        let y = self.line[self.pos];
        self.store = y * (1.0 - damp) + self.store * damp;
        self.line[self.pos] = x + self.store * feedback;
        self.pos += 1;
        if self.pos == self.line.len() {
            self.pos = 0;
        }
        y
    }
}

/// Allpass, der die Echos dichter streut.
#[derive(Debug, Clone)]
struct Allpass {
    line: Vec<f32>,
    pos: usize,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Self {
            line: vec![0.0; len],
            pos: 0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let buffered = self.line[self.pos];
        let y = buffered - x;
        self.line[self.pos] = x + buffered * 0.5;
        self.pos += 1;
        if self.pos == self.line.len() {
            self.pos = 0;
        }
        y
    }
}

/// Längen der Original-Freeverb-Stimmung (44,1 kHz), auf 48 kHz umgerechnet.
const COMBS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES: [usize; 4] = [556, 441, 341, 225];

fn scaled(len: usize) -> usize {
    (len as f32 * RATE / 44_100.0) as usize
}

pub struct Reverb {
    params: ReverbParams,
    combs: Vec<Comb>,
    allpasses: Vec<Allpass>,
    predelay: DelayLine,
    low_cut: Biquad,
    feedback: f32,
    damp: f32,
}

impl Default for Reverb {
    fn default() -> Self {
        Self::new()
    }
}

impl Reverb {
    pub fn new() -> Self {
        let mut r = Self {
            params: ReverbParams::default(),
            combs: COMBS.iter().map(|&l| Comb::new(scaled(l))).collect(),
            allpasses: ALLPASSES.iter().map(|&l| Allpass::new(scaled(l))).collect(),
            predelay: DelayLine::new((RATE * 0.21) as usize),
            low_cut: Biquad::default(),
            feedback: 0.0,
            damp: 0.0,
        };
        r.configure(&ReverbParams::default());
        r
    }

    pub fn configure(&mut self, p: &ReverbParams) {
        self.params = *p;
        // Wie Freeverb: Raumgröße 0,7–0,98, Dämpfung bis 0,4.
        self.feedback = 0.7 + p.size * 0.28;
        self.damp = p.damping * 0.4;
        self.low_cut
            .design(Shape::HighPass, p.low_cut_hz, 0.707, 0.0);
    }

    /// Nur der Hall ohne trockenes Signal.
    #[inline]
    pub fn wet(&mut self, x: f32) -> f32 {
        self.predelay.push(x);
        let delayed = self
            .predelay
            .tap((self.params.predelay_ms / 1000.0 * RATE) as usize);
        // Eingang wie bei Freeverb abschwächen, damit die Kämme nicht übersteuern.
        let input = self.low_cut.process(delayed) * 0.015;
        let mut out = 0.0;
        for comb in &mut self.combs {
            out += comb.process(input, self.feedback, self.damp);
        }
        for ap in &mut self.allpasses {
            out = ap.process(out);
        }
        out
    }

    /// Mischt trocken und Hall nach `mix`; auch bei vollem Hall bleibt die
    /// halbe Stimme stehen, damit man verständlich bleibt.
    pub fn process(&mut self, buf: &mut [f32]) {
        let mix = self.params.mix;
        let dry = 1.0 - mix * 0.5;
        for s in buf.iter_mut() {
            let wet = self.wet(*s);
            *s = *s * dry + wet * mix * 3.0;
        }
    }

    pub fn clear(&mut self) {
        for c in &mut self.combs {
            c.line.iter_mut().for_each(|s| *s = 0.0);
            c.store = 0.0;
        }
        for a in &mut self.allpasses {
            a.line.iter_mut().for_each(|s| *s = 0.0);
        }
        self.predelay.clear();
        self.low_cut.reset();
    }
}

// ------------------------------------------------------------ Echo

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EchoParams {
    pub enabled: bool,
    /// Abstand der Wiederholungen in ms.
    pub time_ms: f32,
    /// Rückkopplung 0–0,95: wie viele Wiederholungen.
    pub feedback: f32,
    /// Höhen in den Wiederholungen (Hz): darüber wird jede Wiederholung dunkler.
    pub tone_hz: f32,
    /// Anteil des Echos 0–1.
    pub mix: f32,
}

impl Default for EchoParams {
    fn default() -> Self {
        Self {
            enabled: false,
            time_ms: 320.0,
            feedback: 0.35,
            tone_hz: 4_000.0,
            mix: 0.3,
        }
    }
}

impl EchoParams {
    pub fn clamped(mut self) -> Self {
        self.time_ms = self.time_ms.clamp(20.0, 1500.0);
        self.feedback = self.feedback.clamp(0.0, 0.95);
        self.tone_hz = self.tone_hz.clamp(500.0, 16_000.0);
        self.mix = self.mix.clamp(0.0, 1.0);
        self
    }
}

pub struct Echo {
    params: EchoParams,
    line: DelayLine,
    tone: Biquad,
    /// Gleitende Verzögerung, damit Ändern der Zeit nicht knackt.
    delay: f32,
}

impl Default for Echo {
    fn default() -> Self {
        Self::new()
    }
}

impl Echo {
    pub fn new() -> Self {
        let mut e = Self {
            params: EchoParams::default(),
            line: DelayLine::new((RATE * 1.6) as usize),
            tone: Biquad::default(),
            delay: EchoParams::default().time_ms / 1000.0 * RATE,
        };
        e.configure(&EchoParams::default());
        e
    }

    pub fn configure(&mut self, p: &EchoParams) {
        self.params = *p;
        self.tone.design(Shape::LowPass, p.tone_hz, 0.707, 0.0);
        // Kleine Schritte (Regler ziehen) gleiten, große Sprünge (Preset) nicht.
        let target = p.time_ms / 1000.0 * RATE;
        if (target - self.delay).abs() > self.delay * 0.2 {
            self.delay = target;
        }
    }

    /// Nur die Wiederholungen ohne trockenes Signal.
    #[inline]
    pub fn wet(&mut self, x: f32) -> f32 {
        let target = self.params.time_ms / 1000.0 * RATE;
        self.delay += (target - self.delay) * 0.0005;
        let y = self.line.read(self.delay);
        let fed = self.tone.process(y) * self.params.feedback;
        // Weich begrenzen, damit hohe Rückkopplung nicht aufschaukelt.
        self.line.push((x + fed).clamp(-1.5, 1.5));
        y
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        let mix = self.params.mix;
        for s in buf.iter_mut() {
            let wet = self.wet(*s);
            *s += wet * mix;
        }
    }

    pub fn clear(&mut self) {
        self.line.clear();
        self.tone.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn energy(buf: &[f32]) -> f32 {
        buf.iter().map(|x| x * x).sum()
    }

    #[test]
    fn reverb_leaves_a_tail() {
        let mut r = Reverb::new();
        r.configure(&ReverbParams {
            mix: 0.5,
            ..Default::default()
        });
        let mut buf = vec![0.0f32; 48_000];
        buf[0] = 1.0;
        r.process(&mut buf);
        // Nach 200 ms klingt noch etwas nach, nach dem Impuls aber leiser als er.
        let tail = energy(&buf[9_600..19_200]);
        assert!(tail > 1e-5, "{tail}");
        assert!(buf[1..].iter().all(|s| s.abs() < 1.0));
    }

    #[test]
    fn bigger_room_rings_longer() {
        let tail = |size: f32| {
            let mut r = Reverb::new();
            r.configure(&ReverbParams {
                size,
                mix: 1.0,
                ..Default::default()
            });
            let mut buf = vec![0.0f32; 96_000];
            buf[0] = 1.0;
            r.process(&mut buf);
            energy(&buf[48_000..])
        };
        assert!(tail(1.0) > tail(0.1) * 10.0);
    }

    #[test]
    fn echo_repeats_after_time() {
        let mut e = Echo::new();
        e.configure(&EchoParams {
            enabled: true,
            time_ms: 100.0,
            feedback: 0.0,
            tone_hz: 16_000.0,
            mix: 1.0,
        });
        let mut buf = vec![0.0f32; 9_600];
        buf[0] = 1.0;
        e.process(&mut buf);
        let (pos, _) = buf[1..]
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
            .unwrap();
        assert!((pos as i32 + 1 - 4_800).abs() <= 2, "{pos}");
    }

    #[test]
    fn echo_feedback_decays() {
        let mut e = Echo::new();
        e.configure(&EchoParams {
            enabled: true,
            time_ms: 50.0,
            feedback: 0.95,
            tone_hz: 16_000.0,
            mix: 1.0,
        });
        let mut buf = vec![0.0f32; 48_000 * 4];
        buf[0] = 1.0;
        e.process(&mut buf);
        assert!(buf.iter().all(|s| s.is_finite() && s.abs() <= 1.6));
        assert!(energy(&buf[48_000 * 3..]) < energy(&buf[..48_000]));
    }
}
