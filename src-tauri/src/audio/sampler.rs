//! Spielt Soundboard-Sounds ab. Jeder Ausgang hat einen eigenen Sampler, der
//! dieselben Befehle bekommt; so laufen Kopfhörer und Kabel unabhängig im
//! Takt ihres Geräts.

use std::sync::Arc;

use crossbeam_channel::Receiver;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::ENGINE_RATE;

/// Kurze Blende beim Stoppen, damit nichts knackt.
const STOP_FADE: usize = ENGINE_RATE as usize / 200;
const MAX_VOICES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayMode {
    /// Erneutes Drücken startet von vorn.
    Restart,
    /// Erneutes Drücken spielt zusätzlich.
    Overlap,
    /// Erneutes Drücken stoppt.
    Toggle,
}

#[derive(Debug, Clone)]
pub struct PlayRequest {
    pub sound_id: i64,
    pub samples: Arc<[f32]>,
    pub start: usize,
    pub end: usize,
    pub gain: f32,
    pub fade_in: usize,
    pub fade_out: usize,
    pub mode: PlayMode,
}

#[derive(Debug, Clone)]
pub enum SamplerCommand {
    Play(PlayRequest),
    Stop(i64),
    StopAll,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayingSound {
    pub id: i64,
    /// Fortschritt 0–1 innerhalb des getrimmten Bereichs.
    pub progress: f32,
}

struct Voice {
    request: PlayRequest,
    pos: usize,
    /// Verbleibende Samples der Stopp-Blende.
    stopping: Option<usize>,
}

impl Voice {
    fn next(&mut self) -> Option<f32> {
        let r = &self.request;
        if self.pos >= r.end || self.stopping == Some(0) {
            return None;
        }
        let mut env = 1.0;
        let played = self.pos - r.start;
        if played < r.fade_in {
            env *= played as f32 / r.fade_in as f32;
        }
        let left = r.end - self.pos;
        if left < r.fade_out {
            env *= left as f32 / r.fade_out as f32;
        }
        if let Some(remaining) = self.stopping.as_mut() {
            env *= *remaining as f32 / STOP_FADE as f32;
            *remaining -= 1;
        }
        let s = r.samples[self.pos] * r.gain * env;
        self.pos += 1;
        Some(s)
    }

    fn stop(&mut self) {
        if self.stopping.is_none() {
            self.stopping = Some(STOP_FADE);
        }
    }

    fn active(&self) -> bool {
        self.stopping.is_none()
    }

    fn progress(&self) -> f32 {
        let r = &self.request;
        (self.pos - r.start) as f32 / (r.end - r.start).max(1) as f32
    }
}

pub struct Sampler {
    commands: Receiver<SamplerCommand>,
    voices: Vec<Voice>,
    /// Nur ein Sampler meldet den Fortschritt an die Oberfläche.
    report: Option<Arc<Mutex<Vec<PlayingSound>>>>,
}

impl Sampler {
    pub fn new(
        commands: Receiver<SamplerCommand>,
        report: Option<Arc<Mutex<Vec<PlayingSound>>>>,
    ) -> Self {
        Self {
            commands,
            voices: Vec::with_capacity(MAX_VOICES),
            report,
        }
    }

    /// Befehle übernehmen; einmal pro Geräte-Callback.
    pub fn poll(&mut self) {
        while let Ok(command) = self.commands.try_recv() {
            match command {
                SamplerCommand::Play(request) => self.play(request),
                SamplerCommand::Stop(id) => self
                    .voices
                    .iter_mut()
                    .filter(|v| v.request.sound_id == id)
                    .for_each(Voice::stop),
                SamplerCommand::StopAll => self.voices.iter_mut().for_each(Voice::stop),
            }
        }
    }

    fn play(&mut self, request: PlayRequest) {
        let id = request.sound_id;
        let playing = self
            .voices
            .iter()
            .any(|v| v.request.sound_id == id && v.active());
        match request.mode {
            PlayMode::Toggle if playing => {
                self.voices
                    .iter_mut()
                    .filter(|v| v.request.sound_id == id)
                    .for_each(Voice::stop);
                return;
            }
            PlayMode::Restart => self
                .voices
                .iter_mut()
                .filter(|v| v.request.sound_id == id)
                .for_each(Voice::stop),
            _ => {}
        }
        if request.start >= request.end {
            return;
        }
        if self.voices.len() >= MAX_VOICES {
            self.voices.remove(0);
        }
        self.voices.push(Voice {
            pos: request.start,
            request,
            stopping: None,
        });
    }

    pub fn is_idle(&self) -> bool {
        self.voices.is_empty()
    }

    /// Nächstes Sample in Engine-Rate, Summe aller Stimmen.
    pub fn next_sample(&mut self) -> f32 {
        let mut sum = 0.0;
        let mut finished = false;
        for voice in &mut self.voices {
            match voice.next() {
                Some(s) => sum += s,
                None => finished = true,
            }
        }
        if finished {
            self.voices
                .retain(|v| v.pos < v.request.end && v.stopping != Some(0));
        }
        sum
    }

    /// Fortschritt melden, ohne den Audio-Thread zu blockieren.
    pub fn report(&self) {
        let Some(report) = &self.report else { return };
        if let Some(mut list) = report.try_lock() {
            list.clear();
            list.extend(
                self.voices
                    .iter()
                    .filter(|v| v.active())
                    .map(|v| PlayingSound {
                        id: v.request.sound_id,
                        progress: v.progress(),
                    }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::unbounded;

    fn request(id: i64, mode: PlayMode) -> PlayRequest {
        PlayRequest {
            sound_id: id,
            samples: vec![1.0; 1000].into(),
            start: 0,
            end: 1000,
            gain: 1.0,
            fade_in: 0,
            fade_out: 0,
            mode,
        }
    }

    #[test]
    fn plays_to_end_and_stops() {
        let (tx, rx) = unbounded();
        let mut sampler = Sampler::new(rx, None);
        tx.send(SamplerCommand::Play(request(1, PlayMode::Restart)))
            .unwrap();
        sampler.poll();
        let sum: f32 = (0..2000).map(|_| sampler.next_sample()).sum();
        assert_eq!(sum, 1000.0);
        assert!(sampler.is_idle());
    }

    #[test]
    fn toggle_stops_second_press() {
        let (tx, rx) = unbounded();
        let mut sampler = Sampler::new(rx, None);
        tx.send(SamplerCommand::Play(request(1, PlayMode::Toggle)))
            .unwrap();
        tx.send(SamplerCommand::Play(request(1, PlayMode::Toggle)))
            .unwrap();
        sampler.poll();
        for _ in 0..STOP_FADE + 1 {
            sampler.next_sample();
        }
        assert!(sampler.is_idle());
    }

    #[test]
    fn overlap_adds_voices() {
        let (tx, rx) = unbounded();
        let mut sampler = Sampler::new(rx, None);
        tx.send(SamplerCommand::Play(request(1, PlayMode::Overlap)))
            .unwrap();
        tx.send(SamplerCommand::Play(request(1, PlayMode::Overlap)))
            .unwrap();
        sampler.poll();
        assert_eq!(sampler.next_sample(), 2.0);
    }
}
