//! Misst Verzögerungen per Kreuzkorrelation über WASAPI-Zeitstempel (QPC).
//!
//! cargo run --release --example latency
//!     Mikrofon → Ode → CABLE Input → CABLE Output
//! ODE_MODE=cable …
//!     nur das Kabel: Rauschen direkt in CABLE Input, Aufnahme an CABLE Output
//! ODE_MODE=self …
//!     Mikrofon doppelt aufnehmen, muss ~0 ms ergeben
//!
//! ODE_MIC=fifine wählt das Mikrofon, ODE_BUFFER_MS=10 den Ode-Puffer.
//!
//! Ausgegeben werden zwei Werte: nach Aufnahme-Zeitstempel (wann das Sample
//! am Wandler war) und nach Callback-Zeit (wann es bei der App ankam).

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::Mutex;

use ode_lib::audio::devices::{self, DeviceInfo};
use ode_lib::audio::engine::{Engine, EngineConfig};

const RATE: u32 = 48_000;
const SECONDS: u64 = 4;
const MAX_LAG_MS: usize = 300;

/// Zeitbasis einer Spur: Zeitpunkt von Sample 0 in ns, aus allen Blöcken
/// per Median geschätzt, damit Anlauf-Ausreißer nicht zählen.
#[derive(Default)]
struct Track {
    samples: Vec<f32>,
    /// (Zeit in ns, Sample-Index, zu dem die Zeit gehört)
    device_times: Vec<(f64, usize)>,
    app_times: Vec<(f64, usize)>,
}

impl Track {
    fn base(times: &[(f64, usize)]) -> f64 {
        let mut bases: Vec<f64> = times
            .iter()
            .map(|&(t, i)| t - i as f64 * 1e9 / RATE as f64)
            .collect();
        bases.sort_by(|a, b| a.partial_cmp(b).unwrap());
        bases[bases.len() / 2]
    }
}

fn check_config(device: &cpal::Device, config: &cpal::SupportedStreamConfig) -> anyhow::Result<()> {
    anyhow::ensure!(
        config.sample_rate() == RATE && config.sample_format() == cpal::SampleFormat::F32,
        "{} läuft mit {} Hz / {}, erwartet 48000 Hz / f32",
        devices::name_of(device),
        config.sample_rate(),
        config.sample_format()
    );
    Ok(())
}

fn record(device: &cpal::Device) -> anyhow::Result<(cpal::Stream, Arc<Mutex<Track>>)> {
    let supported = device.default_input_config()?;
    check_config(device, &supported)?;
    let channels = supported.channels() as usize;
    let track = Arc::new(Mutex::new(Track::default()));
    let sink = track.clone();
    let stream = device.build_input_stream::<f32, _, _>(
        supported.config(),
        move |data, info| {
            let mut t = sink.lock();
            let start = t.samples.len();
            t.samples.extend(data.chunks_exact(channels).map(|f| f[0]));
            let end = t.samples.len();
            let ts = info.timestamp();
            // Erstes Sample war zum Aufnahmezeitpunkt am Wandler,
            // das letzte ist zur Callback-Zeit bei der App.
            t.device_times.push((ts.capture.as_nanos() as f64, start));
            t.app_times.push((ts.callback.as_nanos() as f64, end));
        },
        |err| eprintln!("Aufnahmefehler: {err}"),
        None,
    )?;
    Ok((stream, track))
}

/// Spielt Rauschen ab und merkt sich, was wann ausgegeben wurde.
fn play_noise(device: &cpal::Device) -> anyhow::Result<(cpal::Stream, Arc<Mutex<Track>>)> {
    let supported = device.default_output_config()?;
    check_config(device, &supported)?;
    let channels = supported.channels() as usize;
    let track = Arc::new(Mutex::new(Track::default()));
    let sink = track.clone();
    let mut seed: u32 = 0x1234_5678;
    let stream = device.build_output_stream::<f32, _, _>(
        supported.config(),
        move |data: &mut [f32], info| {
            let mut t = sink.lock();
            let start = t.samples.len();
            for frame in data.chunks_exact_mut(channels) {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let s = (seed as f32 / u32::MAX as f32 - 0.5) * 0.1;
                frame.iter_mut().for_each(|d| *d = s);
                t.samples.push(s);
            }
            let ts = info.timestamp();
            // Erstes Sample erreicht den Wandler zum Wiedergabezeitpunkt,
            // die App hat es zur Callback-Zeit geschrieben.
            t.device_times.push((ts.playback.as_nanos() as f64, start));
            t.app_times.push((ts.callback.as_nanos() as f64, start));
        },
        |err| eprintln!("Wiedergabefehler: {err}"),
        None,
    )?;
    Ok((stream, track))
}

/// Findet die Verzögerung von `late` gegenüber `early` in ms.
fn correlate(early: &[f32], late: &[f32], early_base: f64, late_base: f64) -> (f64, f64) {
    // late[j] ≈ early[j + shift - lag]
    let shift = ((late_base - early_base) * RATE as f64 / 1e9).round() as i64;
    let max_lag = MAX_LAG_MS * RATE as usize / 1000;
    let skip = RATE as usize / 2;
    let window = (RATE as usize * 2).min(late.len().saturating_sub(skip));
    let mut best = (0usize, f64::MIN);
    for lag in 0..max_lag {
        let (mut dot, mut energy) = (0.0f64, 0.0f64);
        for j in skip..skip + window {
            let i = j as i64 + shift - lag as i64;
            if i < 0 || i as usize >= early.len() {
                continue;
            }
            let e = early[i as usize] as f64;
            dot += e * late[j] as f64;
            energy += e * e;
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
    let late_energy: f64 = late[skip..skip + window]
        .iter()
        .map(|&x| (x as f64).powi(2))
        .sum();
    (
        best.0 as f64 * 1000.0 / RATE as f64,
        best.1 / late_energy.sqrt().max(1e-12),
    )
}

fn report(label: &str, early: &Track, late: &Track) {
    let rms = |s: &[f32]| (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt();
    println!(
        "Pegel: Quelle {:.1} dBFS, Ziel {:.1} dBFS",
        20.0 * rms(&early.samples).max(1e-9).log10(),
        20.0 * rms(&late.samples).max(1e-9).log10()
    );
    let (device_ms, c1) = correlate(
        &early.samples,
        &late.samples,
        Track::base(&early.device_times),
        Track::base(&late.device_times),
    );
    let (app_ms, c2) = correlate(
        &early.samples,
        &late.samples,
        Track::base(&early.app_times),
        Track::base(&late.app_times),
    );
    let block_ms =
        |t: &Track| t.samples.len() as f64 * 1000.0 / RATE as f64 / t.app_times.len().max(1) as f64;
    println!(
        "Blockgröße: Quelle {:.1} ms, Ziel {:.1} ms",
        block_ms(early),
        block_ms(late)
    );
    println!("{label}");
    println!("  nach Gerätezeit:   {device_ms:6.1} ms (Korrelation {c1:.2})");
    println!("  nach Callback-Zeit: {app_ms:6.1} ms (Korrelation {c2:.2})");
}

fn find<'a>(list: &'a [DeviceInfo], part: &str) -> anyhow::Result<&'a DeviceInfo> {
    list.iter()
        .find(|d| d.name.contains(part))
        .ok_or_else(|| anyhow::anyhow!("Gerät '{part}' nicht gefunden"))
}

fn main() -> anyhow::Result<()> {
    let host = cpal::default_host();
    let list = devices::list(&host)?;
    let mode = std::env::var("ODE_MODE").unwrap_or_default();
    let mic_part = std::env::var("ODE_MIC").unwrap_or_else(|_| "fifine".into());
    let buffer_ms: f32 = std::env::var("ODE_BUFFER_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10.0);

    let cable_in = find(&list.outputs, "CABLE Input")?;
    let cable_out = find(&list.inputs, "CABLE Output")?;

    if mode == "cable" {
        let (player, sent) = play_noise(&devices::find(&host, &cable_in.id)?)?;
        let (recorder, received) = record(&devices::find(&host, &cable_out.id)?)?;
        player.play()?;
        recorder.play()?;
        std::thread::sleep(Duration::from_secs(SECONDS));
        drop(recorder);
        drop(player);
        report(
            "Nur Kabel (CABLE Input → CABLE Output):",
            &sent.lock(),
            &received.lock(),
        );
        return Ok(());
    }

    let mic = find(&list.inputs, &mic_part)?;
    let engine = Engine::spawn();
    if mode != "self" {
        engine
            .start(EngineConfig {
                input_id: mic.id.clone(),
                monitor_id: None,
                cable_id: Some(cable_in.id.clone()),
                buffer_ms,
            })
            .map_err(anyhow::Error::msg)?;
        std::thread::sleep(Duration::from_millis(500));
    }
    let target = if mode == "self" {
        &mic.id
    } else {
        &cable_out.id
    };
    let (mic_stream, mic_track) = record(&devices::find(&host, &mic.id)?)?;
    let (target_stream, target_track) = record(&devices::find(&host, target)?)?;
    mic_stream.play()?;
    target_stream.play()?;
    std::thread::sleep(Duration::from_secs(SECONDS));
    drop(mic_stream);
    drop(target_stream);
    let underruns = engine
        .mixer
        .out_b
        .underruns
        .load(std::sync::atomic::Ordering::Relaxed);
    engine.stop();

    let label = if mode == "self" {
        "Selbsttest (Mikrofon doppelt):".to_string()
    } else {
        format!("Mikrofon → Ode ({buffer_ms} ms) → Kabel, Aussetzer {underruns}:")
    };
    report(&label, &mic_track.lock(), &target_track.lock());
    Ok(())
}
