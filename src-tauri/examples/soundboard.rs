//! Prüft das Soundboard ohne Oberfläche: legt eine Bibliothek in einem
//! Temp-Ordner an, importiert einen Testton, spielt ihn über die Engine ins
//! Kabel und misst, was an „CABLE Output“ ankommt. Das Mikrofon ist stumm.
//!
//! cargo run --example soundboard

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::Mutex;

use ode_lib::audio::devices;
use ode_lib::audio::engine::{Engine, EngineConfig};
use ode_lib::audio::mixer::ChannelId;
use ode_lib::audio::sampler::SamplerCommand;
use ode_lib::library::Library;

/// 1 s Sinus 440 Hz, 44,1 kHz, 16 Bit mono, halbe Aussteuerung.
fn write_test_wav(path: &std::path::Path) -> anyhow::Result<()> {
    let rate = 44_100u32;
    let frames = rate as usize;
    let mut bytes = Vec::new();
    let data_len = (frames * 2) as u32;
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
        let s =
            ((i as f32 * 2.0 * std::f32::consts::PI * 440.0 / rate as f32).sin() * 16_000.0) as i16;
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let dir = std::env::temp_dir().join("ode-soundboard-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let wav = dir.join("Test Ton.wav");
    write_test_wav(&wav)?;

    let library = Library::open(&dir.join("data"))?;
    let sound = library.import(&wav)?;
    println!(
        "Importiert: „{}“, {} ms, Farbe {}, Wellenform {} Werte",
        sound.name,
        sound.duration_ms,
        sound.color,
        sound.waveform.len()
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

    // Kabel-Ausgang aufnehmen.
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

    let request = library.play_request(&sound)?;
    engine
        .sampler(SamplerCommand::Play(request))
        .map_err(anyhow::Error::msg)?;
    let mut seen_playing = false;
    for _ in 0..15 {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(p) = engine.playing.lock().first() {
            seen_playing = true;
            print!("\rFortschritt {:>3.0} %", p.progress * 100.0);
        }
    }
    println!();
    drop(stream);
    engine.stop();

    let samples = recorded.lock();
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    println!(
        "Am Kabel: Spitze {:.1} dBFS (Datei: −6,0), Fortschritt gemeldet: {seen_playing}",
        20.0 * peak.max(1e-9).log10()
    );
    anyhow::ensure!(peak > 0.3 && seen_playing, "Sound kam nicht im Kabel an");
    println!("OK: Sound kommt im Kabel an.");
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
