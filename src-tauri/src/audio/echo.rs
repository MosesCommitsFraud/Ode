//! Echo-Entfernung mit AEC3 aus WebRTC (über `sonora`, ein reiner Rust-Port).
//! Als Referenz dient, was gerade aus dem Lautsprecher kommt (WASAPI-Loopback,
//! siehe `engine::build_echo_reference`). AEC3 schätzt die Laufzeit bis ins
//! Mikrofon selbst und zieht das Echo ab. Arbeitet in 10-ms-Rahmen und
//! verzögert dadurch um genau einen Rahmen.

use std::collections::VecDeque;

use ringbuf::HeapCons;
use ringbuf::traits::{Consumer, Observer};
use sonora::config::EchoCanceller as Aec3Config;
use sonora::{AudioProcessing, Config, StreamConfig};

use super::{BLOCK_FRAMES, ENGINE_RATE};

/// So viele Rahmen Referenz dürfen sich höchstens stauen (200 ms); ältere
/// werden verworfen, damit die Laufzeit nicht wächst.
const MAX_BACKLOG: usize = 20;
/// Bleibt die Referenz so viele Rahmen aus, ist der Lautsprecher still:
/// WASAPI liefert dann gar nichts, AEC3 bekommt ersatzweise Stille.
const SILENT_AFTER: usize = 5;

/// Messwerte eines Rahmens für die Oberfläche.
#[derive(Debug, Clone, Copy, Default)]
pub struct EchoStats {
    /// Höchster Pegel der Referenz seit dem letzten Rahmen.
    pub reference_peak: f32,
    /// Wie stark das Echo abgesenkt wird (ERLE) in dB.
    pub erle_db: f32,
    /// Geschätzte Laufzeit Lautsprecher → Mikrofon in ms.
    pub delay_ms: f32,
}

pub struct EchoCanceller {
    apm: AudioProcessing,
    reference: Option<HeapCons<f32>>,
    input: VecDeque<f32>,
    output: VecDeque<f32>,
    capture: Vec<f32>,
    render: Vec<f32>,
    scratch: Vec<f32>,
    /// Rahmen in Folge ohne Referenz.
    missing: usize,
    stats: EchoStats,
}

impl EchoCanceller {
    pub fn new() -> Self {
        let stream = StreamConfig::new(ENGINE_RATE, 1);
        let apm = AudioProcessing::builder()
            .config(Config {
                echo_canceller: Some(Aec3Config::default()),
                ..Default::default()
            })
            .capture_config(stream)
            .render_config(stream)
            .build();
        let mut aec = Self {
            apm,
            reference: None,
            input: VecDeque::with_capacity(16_384),
            output: VecDeque::with_capacity(16_384),
            capture: vec![0.0; BLOCK_FRAMES],
            render: vec![0.0; BLOCK_FRAMES],
            scratch: vec![0.0; BLOCK_FRAMES],
            missing: 0,
            stats: EchoStats::default(),
        };
        aec.reset();
        aec
    }

    /// Mitschnitt des Lautsprechers in Engine-Rate, mono.
    pub fn set_reference(&mut self, reference: HeapCons<f32>) {
        self.reference = Some(reference);
    }

    pub fn reset(&mut self) {
        self.input.clear();
        self.output.clear();
        self.output.extend(std::iter::repeat_n(0.0, BLOCK_FRAMES));
        self.missing = 0;
        self.idle();
    }

    /// Ausgeschaltet: Referenz verwerfen, damit beim Einschalten nichts Altes ansteht.
    pub fn idle(&mut self) {
        if let Some(reference) = &mut self.reference {
            reference.skip(reference.occupied_len());
        }
        self.stats = EchoStats::default();
    }

    pub fn stats(&self) -> EchoStats {
        self.stats
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        self.stats.reference_peak = 0.0;
        self.input.extend(buf.iter());
        while self.input.len() >= BLOCK_FRAMES {
            self.feed_reference();
            for (dst, src) in self
                .capture
                .iter_mut()
                .zip(self.input.drain(..BLOCK_FRAMES))
            {
                *dst = src;
            }
            // Fehler gibt es nur bei falschen Formaten; dann bleibt der Rahmen trocken.
            match self
                .apm
                .process_capture_f32(&[&self.capture], &mut [&mut self.scratch])
            {
                Ok(()) => self.output.extend(self.scratch.iter()),
                Err(_) => self.output.extend(self.capture.iter()),
            }
        }
        for s in buf.iter_mut() {
            *s = self.output.pop_front().unwrap_or(0.0);
        }
        let stats = self.apm.statistics();
        self.stats.erle_db = stats
            .echo_return_loss_enhancement
            .map_or(0.0, |v| v.max(0.0) as f32);
        self.stats.delay_ms = stats.delay_ms.map_or(0.0, |v| v.max(0) as f32);
    }

    /// Gibt AEC3 alle vollständigen Referenz-Rahmen, die seit dem letzten
    /// Mikrofon-Rahmen angekommen sind.
    fn feed_reference(&mut self) {
        let Some(reference) = &mut self.reference else {
            return;
        };
        let mut blocks = reference.occupied_len() / BLOCK_FRAMES;
        if blocks > MAX_BACKLOG {
            reference.skip((blocks - MAX_BACKLOG) * BLOCK_FRAMES);
            blocks = MAX_BACKLOG;
        }
        if blocks == 0 {
            self.missing += 1;
            if self.missing >= SILENT_AFTER {
                self.render.fill(0.0);
                let _ = self
                    .apm
                    .process_render_f32(&[&self.render], &mut [&mut self.scratch]);
            }
            return;
        }
        self.missing = 0;
        for _ in 0..blocks {
            reference.pop_slice(&mut self.render);
            let peak = self.render.iter().fold(0.0f32, |m, s| m.max(s.abs()));
            self.stats.reference_peak = self.stats.reference_peak.max(peak);
            let _ = self
                .apm
                .process_render_f32(&[&self.render], &mut [&mut self.scratch]);
        }
    }
}

impl Default for EchoCanceller {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ringbuf::HeapRb;
    use ringbuf::traits::{Producer, Split};

    fn noise(len: usize, seed: u32) -> Vec<f32> {
        let mut seed = seed;
        (0..len)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.4
            })
            .collect()
    }

    fn rms(buf: &[f32]) -> f32 {
        (buf.iter().map(|x| x * x).sum::<f32>() / buf.len() as f32).sqrt()
    }

    /// Lautsprecher spielt Rauschen, das Mikrofon hört es 30 ms später leiser
    /// (ohne eigene Stimme): Nach dem Einlernen bleibt kaum etwas übrig.
    #[test]
    fn removes_delayed_speaker_signal() {
        let (mut producer, consumer) = HeapRb::<f32>::new(48_000).split();
        let mut aec = EchoCanceller::new();
        aec.set_reference(consumer);
        let far = noise(48_000 * 6, 7);
        let delay = 48 * 30;
        let mut out = Vec::new();
        let mut input = Vec::new();
        for (i, block) in far.chunks(BLOCK_FRAMES).enumerate() {
            producer.push_slice(block);
            let start = i * BLOCK_FRAMES;
            let mut mic: Vec<f32> = (start..start + block.len())
                .map(|n| if n >= delay { far[n - delay] * 0.5 } else { 0.0 })
                .collect();
            input.extend_from_slice(&mic);
            aec.process(&mut mic);
            out.extend(mic);
        }
        let tail = 48_000 * 2;
        let before = rms(&input[input.len() - tail..]);
        let after = rms(&out[out.len() - tail..]);
        assert!(after < before * 0.1, "{before} → {after}");
    }

    /// Lautsprecher still (WASAPI liefert nichts): die Stimme bleibt erhalten.
    #[test]
    fn keeps_voice_while_speaker_is_silent() {
        let (_producer, consumer) = HeapRb::<f32>::new(48_000).split();
        let mut aec = EchoCanceller::new();
        aec.set_reference(consumer);
        let voice: Vec<f32> = (0..48_000 * 3)
            .map(|i| (i as f32 * std::f32::consts::TAU * 300.0 / 48_000.0).sin() * 0.3)
            .collect();
        let mut out = Vec::new();
        for block in voice.chunks(BLOCK_FRAMES) {
            let mut b = block.to_vec();
            aec.process(&mut b);
            out.extend(b);
        }
        let tail = 48_000;
        let gain = rms(&out[out.len() - tail..]) / rms(&voice[voice.len() - tail..]);
        assert!((gain - 1.0).abs() < 0.1, "{gain}");
    }
}
