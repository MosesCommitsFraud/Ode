//! Prüft das Musik-Deck ohne Oberfläche: importiert einen 3-s-Testton in eine
//! Temp-Bibliothek, spielt ihn über die Engine ins Kabel, pausiert in der Mitte
//! und misst an „CABLE Output“, ob Ton und Pause ankommen. Mikrofon ist stumm.
//!
//! cargo run --example music

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::Mutex;

use ode_lib::audio::deck::DeckCommand;
use ode_lib::audio::devices;
use ode_lib::audio::engine::{Engine, EngineConfig};
use ode_lib::audio::mixer::ChannelId;
use ode_lib::music::MusicLibrary;

fn write_tone(path: &std::path::Path, seconds: usize) -> anyhow::Result<()> {
    let rate = 48_000u32;
    let frames = rate as usize * seconds;
    let data_len = (frames * 2) as u32;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..frames {
        let s = ((i as f32 * std::f32::consts::TAU * 330.0 / rate as f32).sin() * 16_000.0) as i16;
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Pegel des 330-Hz-Testtons (Goertzel), unabhängig von anderem Ton im Kabel.
fn tone_db(samples: &[f32]) -> f32 {
    let w = std::f32::consts::TAU * 330.0 / 48_000.0;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &x in samples {
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    let amplitude = 2.0 * power.max(0.0).sqrt() / samples.len().max(1) as f32;
    20.0 * amplitude.max(1e-9).log10()
}

fn peak_db(samples: &[f32]) -> f32 {
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    20.0 * peak.max(1e-9).log10()
}

fn main() -> anyhow::Result<()> {
    let dir = std::env::temp_dir().join("ode-music-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let wav = dir.join("Testband - Testtitel.wav");
    write_tone(&wav, 3)?;

    let music = MusicLibrary::open(&dir.join("data"))?;
    let track = music.import(&wav)?;
    println!(
        "Importiert: „{}“ von {:?}, {} ms",
        track.title, track.artist, track.duration_ms
    );

    let host = cpal::default_host();
    let list = devices::list(&host)?;
    let mic = list
        .inputs
        .iter()
        .find(|d| !d.is_virtual_cable)
        .ok_or_else(|| anyhow::anyhow!("kein Mikrofon"))?;
    let cable_in = list
        .outputs
        .iter()
        .find(|d| d.name.starts_with("CABLE Input"))
        .ok_or_else(|| anyhow::anyhow!("kein CABLE Input"))?;
    let cable_out = list
        .inputs
        .iter()
        .find(|d| d.name.starts_with("CABLE Output"))
        .ok_or_else(|| anyhow::anyhow!("kein CABLE Output"))?;

    let engine = Engine::spawn();
    let mut mic_params = engine.mixer.channel(ChannelId::Mic).params();
    mic_params.muted = true;
    engine.mixer.channel(ChannelId::Mic).set(mic_params);
    engine
        .start(EngineConfig {
            input_id: mic.id.clone(),
            monitor_id: None,
            cable_id: Some(cable_in.id.clone()),
            buffer_ms: 10.0,
        })
        .map_err(anyhow::Error::msg)?;

    let device = devices::find(&host, &cable_out.id)?;
    let config = device.default_input_config()?;
    let channels = config.channels() as usize;
    let recorded = Arc::new(Mutex::new(Vec::<f32>::new()));
    let sink = recorded.clone();
    let stream = device.build_input_stream::<f32, _, _>(
        config.config(),
        move |data, _| {
            sink.lock()
                .extend(data.chunks_exact(channels).map(|f| f[0]))
        },
        |e| eprintln!("Aufnahmefehler: {e}"),
        None,
    )?;
    stream.play()?;
    std::thread::sleep(Duration::from_millis(300));
    let mark = |label: &str| {
        let len = recorded.lock().len();
        println!("{label} bei Sample {len}");
        len
    };

    let samples = music.samples(track.id)?;
    engine
        .deck(DeckCommand::Load {
            track_id: track.id,
            samples,
            play: true,
        })
        .map_err(anyhow::Error::msg)?;
    let start = mark("Play");
    std::thread::sleep(Duration::from_millis(800));
    engine
        .deck(DeckCommand::Pause)
        .map_err(anyhow::Error::msg)?;
    let pause = mark("Pause");
    std::thread::sleep(Duration::from_millis(600));
    let status = engine.deck_status.lock().clone();
    engine
        .deck(DeckCommand::Seek(48_000 * 2))
        .map_err(anyhow::Error::msg)?;
    engine.deck(DeckCommand::Play).map_err(anyhow::Error::msg)?;
    let resume = mark("Weiter ab 2 s");
    std::thread::sleep(Duration::from_millis(1500));
    let end_status = engine.deck_status.lock().clone();
    drop(stream);
    engine.stop();

    let rec = recorded.lock();
    if std::env::var("ODE_DEBUG").is_ok() {
        let w = &rec[pause + 9_600..resume];
        let crossings = w
            .windows(2)
            .filter(|p| (p[0] < 0.0) != (p[1] < 0.0))
            .count();
        println!(
            "  Pause: {:.0} Nulldurchgänge/s (330 Hz-Ton ≈ 660)",
            crossings as f32 / (w.len() as f32 / 48_000.0)
        );
        for (i, chunk) in rec[pause..resume].chunks(2400).enumerate() {
            println!("  Pause +{:>3} ms: {:.1} dBFS", i * 50, peak_db(chunk));
        }
    }
    let playing = &rec[start + 9_600..pause];
    let paused = &rec[pause + 9_600..resume];
    // Andere Programme können ebenfalls ins Kabel spielen: Pause gegen den
    // Ruhepegel vor dem Start vergleichen statt gegen absolute Stille.
    let baseline = peak_db(&rec[..start]);
    println!(
        "Ruhe vorher: {:.1} dBFS · Spielt: {:.1} dBFS · Pause: {:.1} dBFS · Position in der Pause {} ms · am Ende fertig: {}",
        baseline,
        peak_db(playing),
        peak_db(paused),
        status.position * 1000 / 48_000,
        end_status.finished
    );
    anyhow::ensure!(peak_db(playing) > -8.0, "Musik kam nicht im Kabel an");
    println!(
        "330-Hz-Ton: spielt {:.1} dB · Pause {:.1} dB",
        tone_db(playing),
        tone_db(paused)
    );
    anyhow::ensure!(
        tone_db(paused) < tone_db(playing) - 50.0,
        "In der Pause lief der Titel weiter"
    );
    anyhow::ensure!(end_status.finished, "Titelende wurde nicht gemeldet");
    println!("OK: Abspielen, Pause, Sprung und Titelende funktionieren.");
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
