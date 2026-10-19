//! Prüft Live-Quellen ohne Oberfläche: startet sich selbst als zweiten Prozess,
//! der einen leisen 440-Hz-Ton (−40 dBFS) abspielt, schneidet nur diesen Prozess
//! mit und misst direkt am Live-Puffer (das Kabel kann gleichzeitig andere
//! Programme enthalten).
//!
//! cargo run --example live            Test
//! cargo run --example live -- list    Programme mit Ton auflisten

use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use ringbuf::HeapRb;
use ringbuf::traits::{Consumer, Observer, Split};

use ode_lib::audio::live::{Live, list_sources};

const TONE: f32 = 440.0;
const AMPLITUDE: f32 = 0.01; // −40 dBFS, sehr leise

fn play_tone(seconds: u64) -> anyhow::Result<()> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| anyhow::anyhow!("kein Ausgabegerät"))?;
    let config = device.default_output_config()?;
    let rate = config.sample_rate() as f32;
    let channels = config.channels() as usize;
    let mut phase = 0.0f32;
    let stream = device.build_output_stream::<f32, _, _>(
        config.config(),
        move |data, _| {
            for frame in data.chunks_exact_mut(channels) {
                let s = (phase * std::f32::consts::TAU).sin() * AMPLITUDE;
                phase = (phase + TONE / rate) % 1.0;
                frame.iter_mut().for_each(|d| *d = s);
            }
        },
        |e| eprintln!("Tonfehler: {e}"),
        None,
    )?;
    stream.play()?;
    std::thread::sleep(Duration::from_secs(seconds));
    Ok(())
}

fn tone_db(samples: &[f32]) -> f32 {
    level_at(samples, TONE)
}

/// Abstand des Testtons zur Nachbarfrequenz 470 Hz: misst den Ton auch dann,
/// wenn andere Programme gleichzeitig ins Kabel spielen.
fn tone_snr(samples: &[f32]) -> f32 {
    level_at(samples, TONE) - level_at(samples, 470.0)
}

fn level_at(samples: &[f32], freq: f32) -> f32 {
    let w = std::f32::consts::TAU * freq / 48_000.0;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &x in samples {
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    20.0 * (2.0 * power.max(0.0).sqrt() / samples.len().max(1) as f32)
        .max(1e-9)
        .log10()
}

fn main() -> anyhow::Result<()> {
    let arg = std::env::args().nth(1);
    if arg.as_deref() == Some("tone") {
        return play_tone(8);
    }
    if arg.as_deref() == Some("list") {
        for s in list_sources()? {
            // ODE_ICONS=<Ordner> speichert die Programm-Icons als PNG.
            if let (Ok(dir), Some(icon)) = (std::env::var("ODE_ICONS"), &s.icon) {
                use base64::Engine as _;
                let data = icon.trim_start_matches("data:image/png;base64,");
                if let Ok(png) = base64::engine::general_purpose::STANDARD.decode(data) {
                    let _ = std::fs::write(format!("{dir}/{}.png", s.name), png);
                }
            }
            println!(
                "{:>6}  {:<20} {:<24} {}",
                s.pid,
                s.name,
                s.exe,
                if s.playing { "spielt" } else { "" }
            );
        }
        return Ok(());
    }

    // Tongeber starten und warten, bis Windows seine Audio-Sitzung kennt.
    let mut child = Command::new(std::env::current_exe()?).arg("tone").spawn()?;
    std::thread::sleep(Duration::from_millis(1500));
    let sources = list_sources()?;
    let source = sources
        .iter()
        .find(|s| s.pid == child.id())
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Tongeber nicht in der Liste: {sources:?}"))?;
    println!(
        "Quelle: {} ({}), spielt: {}",
        source.name, source.exe, source.playing
    );

    // Direkt am Live-Puffer messen: unabhängig davon, was sonst ins Kabel spielt.
    let (producer, mut consumer) = HeapRb::<f32>::new(48_000 * 10).split();
    let live = Live::new(Arc::new(Mutex::new(vec![producer])));
    live.start(source).map_err(anyhow::Error::msg)?;
    println!("Live-Mitschnitt läuft");
    std::thread::sleep(Duration::from_secs(2));
    live.stop();
    let captured: Vec<f32> = consumer.pop_iter().collect();
    std::thread::sleep(Duration::from_millis(500));
    let after_stop = consumer.occupied_len();
    let _ = child.kill();

    let seconds = captured.len() as f32 / 48_000.0;
    let tail = &captured[captured.len().saturating_sub(48_000)..];
    println!(
        "Mitgeschnitten: {seconds:.2} s · 440 Hz {:.1} dB (erwartet −40) · Abstand zu 470 Hz {:.1} dB · nach Stopp noch {after_stop} Samples",
        tone_db(tail),
        tone_snr(tail)
    );
    anyhow::ensure!(
        (1.6..2.4).contains(&seconds),
        "Mitschnitt hat die falsche Länge"
    );
    anyhow::ensure!(
        (tone_db(tail) + 40.0).abs() < 3.0,
        "Ton nicht mit −40 dB mitgeschnitten"
    );
    anyhow::ensure!(
        tone_snr(tail) > 30.0,
        "Mitschnitt enthält nicht nur den Ton"
    );
    anyhow::ensure!(after_stop == 0, "Mitschnitt lief nach dem Stopp weiter");
    println!("OK: Nur der Ton des gewählten Programms wird mitgeschnitten, Stopp wirkt sofort.");
    Ok(())
}
