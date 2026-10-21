//! Kurve für die Anzeige, gerechnet mit dem echten Effekt: ein Testton
//! durch den Charakter. So zeigt die Oberfläche genau, was der Effekt mit
//! diesen Einstellungen tut. Echo und Hall zeigen stattdessen live die
//! Pegel der echten Stimme.

use serde::Deserialize;

use super::character::{Character, CharacterParams};
use crate::audio::ENGINE_RATE;

const RATE: usize = ENGINE_RATE as usize;
/// Punkte der Charakter-Welle.
const POINTS: usize = 200;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    /// Zwei Schwingungen eines 150-Hz-Tons nach dem Effekt, −1 … 1.
    Character { params: CharacterParams },
}

/// Charakter: eine Kurve, die Welle.
pub fn render(preview: Preview) -> Vec<Vec<f32>> {
    match preview {
        Preview::Character { params } => {
            let mut character = Character::new();
            character.configure(&params);
            // Frisch gebaut statt nach kurzer Ruhe übergeblendet.
            character.clear();
            let period = RATE / 150;
            // Einschwingen lassen, dann zwei Schwingungen nehmen.
            let mut buf: Vec<f32> = (0..period * 12)
                .map(|i| (i as f32 * std::f32::consts::TAU * 150.0 / RATE as f32).sin() * 0.8)
                .collect();
            character.process(&mut buf);
            let tail = &buf[buf.len() - period * 2..];
            vec![(0..POINTS).map(|i| tail[i * tail.len() / POINTS]).collect()]
        }
    }
}
