//! Kurven für die Anzeige, gerechnet mit den echten Effekten: ein Impuls
//! durch Echo oder Hall, ein Testton durch den Charakter. So zeigt die
//! Oberfläche genau, was der Effekt mit diesen Einstellungen tut.

use serde::Deserialize;

use super::character::{Character, CharacterParams};
use super::space::{Echo, EchoParams, Reverb, ReverbParams};
use crate::audio::ENGINE_RATE;

const RATE: usize = ENGINE_RATE as usize;
/// Punkte je Kurve.
const POINTS: usize = 200;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    /// Wiederholungen über 2 s: Spitzenwert je Abschnitt, 0–1.
    Echo { params: EchoParams },
    /// Abklingen über 4 s in dB (−80 … 0), relativ zur lautesten Stelle.
    Reverb { params: ReverbParams },
    /// Zwei Schwingungen eines 150-Hz-Tons nach dem Effekt, −1 … 1.
    Character { params: CharacterParams },
}

pub fn render(preview: Preview) -> Vec<f32> {
    match preview {
        Preview::Echo { params } => {
            let mut echo = Echo::new();
            echo.configure(&EchoParams { mix: 1.0, ..params });
            let samples: Vec<f32> = (0..RATE * 2)
                .map(|i| echo.wet(if i == 0 { 1.0 } else { 0.0 }))
                .collect();
            envelope(&samples, |chunk| {
                chunk.iter().fold(0.0f32, |m, s| m.max(s.abs()))
            })
            .into_iter()
            .map(|v| v.min(1.0))
            .collect()
        }
        Preview::Reverb { params } => {
            let mut reverb = Reverb::new();
            reverb.configure(&params);
            let samples: Vec<f32> = (0..RATE * 4)
                .map(|i| reverb.wet(if i == 0 { 1.0 } else { 0.0 }))
                .collect();
            let rms = envelope(&samples, |chunk| {
                (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt()
            });
            let peak = rms.iter().copied().fold(1e-9f32, f32::max);
            rms.iter()
                .map(|v| (20.0 * (v / peak).max(1e-4).log10()).max(-80.0))
                .collect()
        }
        Preview::Character { params } => {
            let mut character = Character::new();
            character.configure(&params);
            let period = RATE / 150;
            // Einschwingen lassen, dann zwei Schwingungen nehmen.
            let mut buf: Vec<f32> = (0..period * 12)
                .map(|i| (i as f32 * std::f32::consts::TAU * 150.0 / RATE as f32).sin() * 0.8)
                .collect();
            character.process(&mut buf);
            let tail = &buf[buf.len() - period * 2..];
            (0..POINTS).map(|i| tail[i * tail.len() / POINTS]).collect()
        }
    }
}

/// `POINTS` Werte, je einer pro gleich langem Abschnitt.
fn envelope(samples: &[f32], value: impl Fn(&[f32]) -> f32) -> Vec<f32> {
    let size = samples.len() / POINTS;
    samples.chunks(size).take(POINTS).map(value).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_shows_repeats_at_the_set_time() {
        let curve = render(Preview::Echo {
            params: EchoParams {
                enabled: true,
                time_ms: 500.0,
                feedback: 0.5,
                tone_hz: 16_000.0,
                mix: 0.5,
            },
        });
        // 500 ms = Viertel von 2 s → Punkt 50.
        let (pos, _) = curve
            .iter()
            .enumerate()
            .skip(1)
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap();
        assert!((49..=51).contains(&pos), "{pos}");
    }

    #[test]
    fn reverb_decays() {
        let curve = render(Preview::Reverb {
            params: ReverbParams {
                enabled: true,
                ..Default::default()
            },
        });
        assert!(curve[POINTS - 1] < curve[10] - 20.0, "{:?}", &curve[..20]);
    }
}
