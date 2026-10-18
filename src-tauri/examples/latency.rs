//! Misst die echte Verzögerung Mikrofon → Kabel: Ode schickt das Mikrofon
//! ins Kabel, gleichzeitig werden Mikrofon und Kabel-Ausgang aufgenommen und
//! per Kreuzkorrelation verglichen. Die Zeitstempel kommen von WASAPI (QPC).
//!
//! cargo run --release --example latency            Mikrofon per ODE_MIC, Standard: fifine
//! ODE_BUFFER_MS=5 cargo run --release --example latency
//! ODE_SELFTEST=1 …   nimmt das Mikrofon doppelt auf, muss ~0 ms ergeben

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::Mutex;

use ode_lib::audio::devices;
use ode_lib::audio::engine::{Engine, EngineConfig};

const RATE: u32 = 48_000;
const SECONDS: u64 = 4;
const MAX_LAG_MS: usize = 200;

#[derive(Default)]
struct Recording {
    /// Aufnahmezeitpunkt des ersten Samples in ns.
    start_ns: Option<u128>,
    samples: Vec<f32>,
}

fn record(device: &cpal::Device) -> anyhow::Result<(cpal::Stream, Arc<Mutex<Recording>>)> {
    let supported = device.default_input_config()?;
    anyhow::ensure!(
        supported.sample_rate() == RATE && supported.sample_format() == cpal::SampleFormat::F32,
        "{} läuft mit {} Hz / {}, erwartet 48000 Hz / f32",
        devices::name_of(device),
        supported.sample_rate(),
        supported.sample_format()
    );
    let channels = supported.channels() as usize;
    let recording = Arc::new(Mutex::new(Recording::default()));
    let sink = recording.clone();
    let stream = device.build_input_stream::<f32, _, _>(
        supported.config(),
        move |data, info| {
            let mut rec = sink.lock();
            if rec.start_ns.is_none() {
                rec.start_ns = Some(info.timestamp().capture.as_nanos());
            }
            rec.samples
                .extend(data.chunks_exact(channels).map(|f| f[0]));
        },
        |err| eprintln!("Aufnahmefehler: {err}"),
        None,
    )?;
    Ok((stream, recording))
}

fn main() -> anyhow::Result<()> {
    let host = cpal::default_host();
    let list = devices::list(&host)?;
    let mic_part = std::env::var("ODE_MIC").unwrap_or_else(|_| "fifine".into());
    let buffer_ms: f32 = std::env::var("ODE_BUFFER_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10.0);

    let mic = list
        .inputs
        .iter()
        .find(|d| d.name.contains(&mic_part))
        .ok_or_else(|| anyhow::anyhow!("Mikrofon '{mic_part}' nicht gefunden"))?;
    let cable_in = list
        .outputs
        .iter()
        .find(|d| d.name.starts_with("CABLE Input"))
        .ok_or_else(|| anyhow::anyhow!("CABLE Input nicht gefunden"))?;
    let cable_out = list
        .inputs
        .iter()
        .find(|d| d.name.starts_with("CABLE Output"))
        .ok_or_else(|| anyhow::anyhow!("CABLE Output nicht gefunden"))?;
    println!(
        "Mikrofon: {}\nKabel:    {} → {}\nPuffer:   {buffer_ms} ms\n",
        mic.name, cable_in.name, cable_out.name
    );

    let engine = Engine::spawn();
    let info = engine
        .start(EngineConfig {
            input_id: mic.id.clone(),
            monitor_id: None,
            cable_id: Some(cable_in.id.clone()),
            buffer_ms,
        })
        .map_err(anyhow::Error::msg)?;
    println!(
        "Engine: Eingang {} Hz, Kabel {} Hz",
        info.input.sample_rate,
        info.cable.as_ref().map_or(0, |c| c.sample_rate)
    );

    // Einschwingen lassen, dann beide Seiten aufnehmen.
    std::thread::sleep(Duration::from_millis(500));
    let (mic_stream, mic_rec) = record(&devices::find(&host, &mic.id)?)?;
    let reference = if std::env::var("ODE_SELFTEST").is_ok() {
        &mic.id
    } else {
        &cable_out.id
    };
    let (cable_stream, cable_rec) = record(&devices::find(&host, reference)?)?;
    mic_stream.play()?;
    cable_stream.play()?;
    println!("Nehme {SECONDS} s auf – gern ins Mikrofon sprechen oder klopfen …");
    std::thread::sleep(Duration::from_secs(SECONDS));
    drop(mic_stream);
    drop(cable_stream);

    let underruns = engine
        .mixer
        .out_b
        .underruns
        .load(std::sync::atomic::Ordering::Relaxed);
    let overruns = engine
        .mixer
        .out_b
        .overruns
        .load(std::sync::atomic::Ordering::Relaxed);
    engine.stop();

    let mic_rec = mic_rec.lock();
    let cable_rec = cable_rec.lock();
    let (Some(tm0), Some(tc0)) = (mic_rec.start_ns, cable_rec.start_ns) else {
        anyhow::bail!("keine Aufnahme");
    };
    println!(
        "Startversatz Aufnahme: {:.1} ms",
        (tc0 as f64 - tm0 as f64) / 1e6
    );
    let mic = &mic_rec.samples;
    let cab = &cable_rec.samples;
    let rms = |s: &[f32]| (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt();
    println!(
        "Pegel: Mikrofon {:.1} dBFS, Kabel {:.1} dBFS",
        20.0 * rms(mic).max(1e-9).log10(),
        20.0 * rms(cab).max(1e-9).log10()
    );

    // cab[j] ≈ mic[j + shift - lag], shift = Startversatz in Samples.
    let shift = ((tc0 as f64 - tm0 as f64) * RATE as f64 / 1e9).round() as i64;
    let max_lag = MAX_LAG_MS * RATE as usize / 1000;
    let window = (RATE as usize * 2).min(cab.len().saturating_sub(max_lag));
    let skip = max_lag;
    let mut best = (0usize, f64::MIN);
    for lag in 0..max_lag {
        let mut dot = 0.0f64;
        let mut energy = 0.0f64;
        for j in skip..skip + window {
            let i = j as i64 + shift - lag as i64;
            if i < 0 || i as usize >= mic.len() {
                continue;
            }
            let m = mic[i as usize] as f64;
            dot += m * cab[j] as f64;
            energy += m * m;
        }
        let score = if energy > 0.0 {
            dot / energy.sqrt()
        } else {
            0.0
        };
        if score > best.1 {
            best = (lag, score);
        }
    }
    let cab_energy: f64 = cab[skip..skip + window]
        .iter()
        .map(|&x| (x as f64).powi(2))
        .sum();
    let correlation = best.1 / cab_energy.sqrt().max(1e-12);

    println!(
        "\nVerzögerung Mikrofon → Kabel: {:.1} ms (Korrelation {:.2})",
        best.0 as f64 * 1000.0 / RATE as f64,
        correlation
    );
    println!("Aussetzer {underruns}, Korrekturen {overruns}");
    if correlation < 0.5 {
        println!("Achtung: schwache Korrelation, Ergebnis unsicher (zu leise?)");
    }
    Ok(())
}
