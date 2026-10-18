//! Musik-Deck: spielt einen Titel ab, mit Pause, Sprung und weichen
//! Übergängen. Wie beim Sampler hat jeder Ausgang sein eigenes Deck, das
//! dieselben Befehle bekommt.

use std::sync::Arc;

use crossbeam_channel::Receiver;
use parking_lot::Mutex;
use serde::Serialize;

use super::ENGINE_RATE;

/// Blende bei Pause, Fortsetzen und Sprung: 8 ms.
const FADE: f32 = 1.0 / (ENGINE_RATE as f32 * 0.008);

#[derive(Debug, Clone)]
pub enum DeckCommand {
    Load {
        track_id: i64,
        samples: Arc<[f32]>,
        play: bool,
    },
    Play,
    Pause,
    /// Position in Samples (Engine-Rate).
    Seek(usize),
    Unload,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckStatus {
    pub track_id: Option<i64>,
    pub position: usize,
    pub length: usize,
    pub playing: bool,
    /// Titel lief bis zum Ende; die Steuerung springt dann weiter.
    pub finished: bool,
}

pub struct Deck {
    commands: Receiver<DeckCommand>,
    track: Option<(i64, Arc<[f32]>)>,
    pos: usize,
    playing: bool,
    finished: bool,
    gain: f32,
    /// Ausstehender Sprung, sobald ausgeblendet ist.
    pending_seek: Option<usize>,
    report: Option<Arc<Mutex<DeckStatus>>>,
}

impl Deck {
    pub fn new(commands: Receiver<DeckCommand>, report: Option<Arc<Mutex<DeckStatus>>>) -> Self {
        Self {
            commands,
            track: None,
            pos: 0,
            playing: false,
            finished: false,
            gain: 0.0,
            pending_seek: None,
            report,
        }
    }

    pub fn poll(&mut self) {
        while let Ok(command) = self.commands.try_recv() {
            match command {
                DeckCommand::Load {
                    track_id,
                    samples,
                    play,
                } => {
                    self.track = Some((track_id, samples));
                    self.pos = 0;
                    self.gain = 0.0;
                    self.playing = play;
                    self.finished = false;
                    self.pending_seek = None;
                }
                DeckCommand::Play => {
                    if self.track.is_some() {
                        self.playing = true;
                        self.finished = false;
                    }
                }
                DeckCommand::Pause => self.playing = false,
                DeckCommand::Seek(pos) => {
                    if self.gain > 0.0 && self.playing {
                        self.pending_seek = Some(pos);
                    } else {
                        self.pos = pos;
                    }
                    self.finished = false;
                }
                DeckCommand::Unload => {
                    self.track = None;
                    self.playing = false;
                    self.pos = 0;
                }
            }
        }
    }

    pub fn is_idle(&self) -> bool {
        self.track.is_none() || (!self.playing && self.gain <= 0.0)
    }

    pub fn next_sample(&mut self) -> f32 {
        let Some((_, samples)) = &self.track else {
            return 0.0;
        };
        let target = if self.playing && self.pending_seek.is_none() {
            1.0
        } else {
            0.0
        };
        if self.gain < target {
            self.gain = (self.gain + FADE).min(1.0);
        } else if self.gain > target {
            self.gain = (self.gain - FADE).max(0.0);
        }
        if self.gain <= 0.0 {
            if let Some(pos) = self.pending_seek.take() {
                self.pos = pos;
            }
            return 0.0;
        }
        match samples.get(self.pos) {
            Some(&s) => {
                self.pos += 1;
                s * self.gain
            }
            None => {
                self.playing = false;
                self.finished = true;
                self.gain = 0.0;
                0.0
            }
        }
    }

    pub fn report(&self) {
        let Some(report) = &self.report else { return };
        if let Some(mut status) = report.try_lock() {
            status.track_id = self.track.as_ref().map(|(id, _)| *id);
            status.length = self.track.as_ref().map_or(0, |(_, s)| s.len());
            status.position = self.pending_seek.unwrap_or(self.pos);
            status.playing = self.playing;
            status.finished = self.finished;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::unbounded;

    fn deck_with(len: usize) -> (crossbeam_channel::Sender<DeckCommand>, Deck) {
        let (tx, rx) = unbounded();
        let deck = Deck::new(rx, None);
        tx.send(DeckCommand::Load {
            track_id: 7,
            samples: vec![1.0; len].into(),
            play: true,
        })
        .unwrap();
        (tx, deck)
    }

    #[test]
    fn plays_to_end_and_finishes() {
        let (_tx, mut deck) = deck_with(1000);
        deck.poll();
        for _ in 0..1100 {
            deck.next_sample();
        }
        assert!(deck.finished);
        assert!(!deck.playing);
    }

    #[test]
    fn pause_fades_out_and_holds_position() {
        let (tx, mut deck) = deck_with(48_000);
        deck.poll();
        for _ in 0..2000 {
            deck.next_sample();
        }
        tx.send(DeckCommand::Pause).unwrap();
        deck.poll();
        for _ in 0..1000 {
            deck.next_sample();
        }
        let held = deck.pos;
        for _ in 0..1000 {
            assert_eq!(deck.next_sample(), 0.0);
        }
        assert_eq!(deck.pos, held);
    }

    #[test]
    fn seek_jumps_after_fade() {
        let (tx, mut deck) = deck_with(48_000);
        deck.poll();
        for _ in 0..1000 {
            deck.next_sample();
        }
        tx.send(DeckCommand::Seek(30_000)).unwrap();
        deck.poll();
        for _ in 0..1000 {
            deck.next_sample();
        }
        assert!(deck.pos > 30_000 && deck.pos < 31_000, "{}", deck.pos);
    }
}
