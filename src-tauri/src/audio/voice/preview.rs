//! Kurven für die Anzeige, gerechnet mit den echten Effekten: ein kurzes
//! gesprochenes Wort durch Echo oder Hall, ein Testton durch den Charakter.
//! So zeigt die Oberfläche genau, was der Effekt mit diesen Einstellungen tut.

use serde::Deserialize;

use super::character::{Character, CharacterParams};
use super::space::{Echo, EchoParams, Reverb, ReverbParams};
use crate::audio::ENGINE_RATE;

const RATE: usize = ENGINE_RATE as usize;
/// Punkte der Charakter-Welle.
const POINTS: usize = 200;
/// Punkte je Kurve bei Echo und Hall.
const WAVE_POINTS: usize = 400;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    /// Ein Wort und seine Wiederholungen über 2,5 s.
    Echo { params: EchoParams },
    /// Ein Wort und sein Nachhall über 4 s.
    Reverb { params: ReverbParams },
    /// Zwei Schwingungen eines 150-Hz-Tons nach dem Effekt, −1 … 1.
    Character { params: CharacterParams },
}

/// Echo und Hall: drei Kurven mit je `WAVE_POINTS` Werten – Spitzenpegel
/// des trockenen Worts, Spitzenpegel des Effekts (mit Anteil, wie er im Mix
/// landet) und die Helligkeit des Effekts 0–1 (1 = so hell wie das Wort).
/// Charakter: eine Kurve, die Welle.
pub fn render(preview: Preview) -> Vec<Vec<f32>> {
    match preview {
        Preview::Echo { params } => {
            let mut echo = Echo::new();
            echo.configure(&params);
            let dry = word(RATE * 5 / 2);
            let wet: Vec<f32> = dry.iter().map(|&x| echo.wet(x) * params.mix).collect();
            curves(&dry, &wet)
        }
        Preview::Reverb { params } => {
            let mut reverb = Reverb::new();
            reverb.configure(&params);
            // Wie `Reverb::process`: auch bei vollem Hall bleibt die halbe Stimme.
            let word = word(RATE * 4);
            let wet: Vec<f32> = word
                .iter()
                .map(|&x| reverb.wet(x) * params.mix * 3.0)
                .collect();
            let dry: Vec<f32> = word.iter().map(|&x| x * (1.0 - params.mix * 0.5)).collect();
            curves(&dry, &wet)
        }
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

/// Ein kurzes „Hallo“ (450 ms), danach Stille bis `len`: ein Hauch aus
/// Rauschen, dann zwei Silben aus einem leicht fallenden Grundton mit
/// Obertönen bis etwa 6 kHz – genug Höhen, dass man dunklere Echos sieht.
fn word(len: usize) -> Vec<f32> {
    let window = |t: f32, from: f32, to: f32| {
        if t <= from || t >= to {
            0.0
        } else {
            (std::f32::consts::PI * (t - from) / (to - from))
                .sin()
                .powi(2)
        }
    };
    let mut seed = 0x1234_5678u32;
    let mut phase = 0.0f32;
    let mut out: Vec<f32> = (0..len)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            if t > 0.45 {
                return 0.0;
            }
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
            phase += (150.0 - 30.0 * t) / RATE as f32;
            let tone: f32 = (1..=40)
                .map(|k| (phase * k as f32 * std::f32::consts::TAU).sin() / k as f32)
                .sum();
            noise * window(t, 0.0, 0.05) * 0.6
                + tone * (window(t, 0.03, 0.2) + window(t, 0.24, 0.44) * 0.8)
        })
        .collect();
    let peak = out.iter().fold(1e-9f32, |m, s| m.max(s.abs()));
    out.iter_mut().for_each(|s| *s *= 0.9 / peak);
    out
}

/// Spitzenpegel von trocken und Effekt, dazu die Helligkeit des Effekts.
fn curves(dry: &[f32], wet: &[f32]) -> Vec<Vec<f32>> {
    let peak = |chunk: &[f32]| chunk.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    let reference = brightness(dry).max(1e-6);
    vec![
        envelope(dry, peak),
        envelope(wet, peak),
        envelope(wet, |chunk| (brightness(chunk) / reference).min(1.0)),
    ]
}

/// Grobe Helligkeit: Pegel der Änderung von Sample zu Sample im Verhältnis
/// zum Pegel selbst. Ein Tiefpass senkt sie, Stille hat keine.
fn brightness(samples: &[f32]) -> f32 {
    let power: f32 = samples.iter().map(|s| s * s).sum();
    if power < 1e-9 {
        return 0.0;
    }
    let change: f32 = samples.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum();
    (change / power).sqrt()
}

/// `WAVE_POINTS` Werte, je einer pro gleich langem Abschnitt.
fn envelope(samples: &[f32], value: impl Fn(&[f32]) -> f32) -> Vec<f32> {
    let size = samples.len() / WAVE_POINTS;
    samples.chunks(size).take(WAVE_POINTS).map(value).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn echo(time_ms: f32, tone_hz: f32) -> Vec<Vec<f32>> {
        render(Preview::Echo {
            params: EchoParams {
                enabled: true,
                time_ms,
                feedback: 0.5,
                tone_hz,
                mix: 0.5,
            },
        })
    }

    #[test]
    fn echo_repeats_the_word_after_the_set_time() {
        let curves = echo(500.0, 16_000.0);
        let wet = &curves[1];
        let loudest = wet.iter().copied().fold(0.0f32, f32::max);
        // 500 ms von 2,5 s → Punkt 80.
        let start = wet.iter().position(|&v| v > loudest * 0.05).unwrap();
        assert!((78..=84).contains(&start), "{start}");
    }

    #[test]
    fn darker_tone_shows_duller_repeats() {
        let bright = echo(500.0, 16_000.0);
        let dark = echo(500.0, 1_000.0);
        let mean = |c: &[Vec<f32>]| c[2][80..160].iter().sum::<f32>();
        assert!(
            mean(&dark) < mean(&bright) * 0.7,
            "{} {}",
            mean(&dark),
            mean(&bright)
        );
    }

    #[test]
    fn reverb_decays() {
        let curves = render(Preview::Reverb {
            params: ReverbParams {
                enabled: true,
                ..Default::default()
            },
        });
        let wet = &curves[1];
        assert!(wet[WAVE_POINTS - 1] < wet[60] * 0.1, "{:?}", &wet[..80]);
    }
}
