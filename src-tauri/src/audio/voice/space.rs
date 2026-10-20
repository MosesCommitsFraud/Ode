//! Raum und Zeit: Hall und Echo, gebaut aus fundsp. Beide arbeiten Sample
//! für Sample, damit sie auch als Effekt-Bus im Ausgang laufen können.

use serde::{Deserialize, Serialize};

use fundsp::prelude32::*;

use crate::audio::fund::{Fixed, Rebuilt};

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

/// Feste Teile des Halls: Raumgröße und Dämpfung (in Hundertsteln).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Room {
    size: u16,
    damping: u16,
}

impl Room {
    fn of(p: &ReverbParams) -> Self {
        Self {
            size: (p.size * 100.0).round() as u16,
            damping: (p.damping * 100.0).round() as u16,
        }
    }
}

/// fundsp-Hall (Feedback-Delay-Netz mit Diffusion und Modulation): 10–30 m
/// Raum, 0,3–6 s Nachhall, die Dämpfung als Tiefpass in der Schleife.
fn room_graph(room: Room) -> Box<dyn AudioUnit> {
    let size = room.size as f32 / 100.0;
    let damping = room.damping as f32 / 100.0;
    let meters = 10.0 + 20.0 * size;
    let seconds = 0.3 + 5.7 * size * size;
    let cutoff = 12_000.0 * 0.12f32.powf(damping);
    Box::new(
        split::<U2>()
            >> reverb2_stereo(meters, seconds, 0.75, 0.5, lowpole_hz(cutoff))
            >> join::<U2>(),
    )
}

/// Hall aus fundsp: Vorverzögerung und Low-Cut laufen live, Raumgröße und
/// Dämpfung bauen den Raum neu (weich übergeblendet).
pub struct Reverb {
    params: ReverbParams,
    predelay: Shared,
    low_cut: Shared,
    input: Fixed,
    room: Rebuilt<Room>,
    /// Noch still (neu oder geleert): Raumänderungen gelten sofort.
    fresh: bool,
}

impl Default for Reverb {
    fn default() -> Self {
        Self::new()
    }
}

/// Kürzeste Vorverzögerung, die die Verzögerungsleitung kann.
const MIN_PREDELAY: f32 = 0.000_5;

impl Reverb {
    pub fn new() -> Self {
        let p = ReverbParams::default();
        let predelay = shared(p.predelay_ms / 1000.0);
        let low_cut = shared(p.low_cut_hz);
        let input = Fixed::new(Box::new(
            (pass() | var(&predelay))
                >> tap(MIN_PREDELAY, 0.21)
                >> (pass() | var(&low_cut) | dc(0.707))
                >> highpass(),
        ));
        let mut r = Self {
            params: p,
            predelay,
            low_cut,
            input,
            room: Rebuilt::new(Room::of(&p), room_graph),
            fresh: true,
        };
        r.configure(&p);
        r
    }

    pub fn configure(&mut self, p: &ReverbParams) {
        self.params = *p;
        self.predelay
            .set_value((p.predelay_ms / 1000.0).max(MIN_PREDELAY));
        self.low_cut.set_value(p.low_cut_hz);
        if self.fresh {
            self.room.set_now(Room::of(p));
        } else {
            self.room.want(Room::of(p));
        }
    }

    /// Nur der Hall ohne trockenes Signal.
    #[inline]
    pub fn wet(&mut self, x: f32) -> f32 {
        self.fresh = false;
        let x = self.input.tick(x);
        self.room.tick(x) * (1.0 / 3.0)
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
        self.input.reset();
        self.room.reset();
        self.fresh = true;
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

/// Echo aus fundsp: Verzögerung mit Rückkopplung, jede Wiederholung durch
/// einen Tiefpass dunkler. Alle Werte laufen live; die Zeit gleitet bei
/// kleinen Änderungen, damit Ziehen am Regler nicht knackt.
pub struct Echo {
    params: EchoParams,
    time: Shared,
    tone: Shared,
    feedback: Shared,
    unit: Fixed,
    /// Gleitende Verzögerung in Sekunden.
    delay: f32,
}

impl Default for Echo {
    fn default() -> Self {
        Self::new()
    }
}

impl Echo {
    pub fn new() -> Self {
        let p = EchoParams::default();
        let time = shared(p.time_ms / 1000.0);
        let tone = shared(p.tone_hz);
        let feedback = shared(p.feedback);
        let unit = Fixed::new(Box::new(feedback2(
            (pass() | var(&time))
                >> tap(0.02, 1.6)
                >> (pass() | var(&tone) | dc(0.707))
                >> lowpass(),
            pass() * var(&feedback),
        )));
        let mut e = Self {
            params: p,
            time,
            tone,
            feedback,
            unit,
            delay: p.time_ms / 1000.0,
        };
        e.configure(&p);
        e
    }

    pub fn configure(&mut self, p: &EchoParams) {
        self.params = *p;
        self.tone.set_value(p.tone_hz);
        self.feedback.set_value(p.feedback);
        // Kleine Schritte (Regler ziehen) gleiten, große Sprünge (Preset) nicht.
        let target = p.time_ms / 1000.0;
        if (target - self.delay).abs() > self.delay * 0.2 {
            self.delay = target;
            self.time.set_value(target);
        }
    }

    /// Nur die Wiederholungen ohne trockenes Signal.
    #[inline]
    pub fn wet(&mut self, x: f32) -> f32 {
        let target = self.params.time_ms / 1000.0;
        if self.delay != target {
            self.delay += (target - self.delay) * 0.0005;
            self.time.set_value(self.delay);
        }
        // Weich begrenzen, damit hohe Rückkopplung nicht aufschaukelt.
        self.unit.tick(x).clamp(-1.5, 1.5)
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        let mix = self.params.mix;
        for s in buf.iter_mut() {
            let wet = self.wet(*s);
            *s += wet * mix;
        }
    }

    pub fn clear(&mut self) {
        self.unit.reset();
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
        assert!((pos as i32 + 1 - 4_800).abs() <= 4, "{pos}");
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
