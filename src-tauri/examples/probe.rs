//! Prüft die Engine ohne Oberfläche: listet Geräte und misst, ob das
//! Mikrofon im Kabel ankommt.
//!
//! cargo run --example probe            Geräte auflisten
//! cargo run --example probe -- run 5   5 s Mikrofon → Kabel (ohne Kopfhörer)
//! cargo run --example probe -- run 5 fifine
//!     ohne Kabel: beliebiger Ausgang (Namensteil), stummgeschaltet
//! ODE_MIC=fifine wählt das Mikrofon über einen Namensteil.

use std::sync::atomic::Ordering;
use std::time::Duration;

use ode_lib::audio::devices;
use ode_lib::audio::engine::{Engine, EngineConfig};
use ode_lib::audio::mixer::ChannelId;

fn main() -> anyhow::Result<()> {
    let host = cpal::default_host();
    let list = devices::list(&host)?;
    println!("Eingänge:");
    for d in &list.inputs {
        println!(
            "  {}{} {}  [{}]",
            if d.is_default { "*" } else { " " },
            if d.is_virtual_cable { "~" } else { " " },
            d.name,
            d.id
        );
    }
    println!("Ausgänge:");
    for d in &list.outputs {
        println!(
            "  {}{} {}  [{}]",
            if d.is_default { "*" } else { " " },
            if d.is_virtual_cable { "~" } else { " " },
            d.name,
            d.id
        );
    }

    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("run") {
        return Ok(());
    }
    let seconds: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(5);

    let input_part = std::env::var("ODE_MIC").ok();
    let input = match &input_part {
        Some(part) => list.inputs.iter().find(|d| d.name.contains(part.as_str())),
        None => list
            .inputs
            .iter()
            .find(|d| d.is_default && !d.is_virtual_cable),
    }
    .or_else(|| list.inputs.iter().find(|d| !d.is_virtual_cable))
    .ok_or_else(|| anyhow::anyhow!("kein Mikrofon"))?;
    let fallback = args.next();
    let cable = match &fallback {
        Some(part) => list.outputs.iter().find(|d| d.name.contains(part.as_str())),
        None => list
            .outputs
            .iter()
            .find(|d| d.name.starts_with("CABLE Input"))
            .or_else(|| list.outputs.iter().find(|d| d.is_virtual_cable)),
    }
    .ok_or_else(|| anyhow::anyhow!("kein virtuelles Kabel"))?;

    let engine = Engine::spawn();
    if fallback.is_some() {
        // Kein echtes Kabel: Ausgang stumm, damit nichts hörbar wird.
        let mut params = engine.mixer.out_b.params();
        params.muted = true;
        engine.mixer.out_b.set(params);
    }
    println!(
        "Mikrofon: {}
Ausgang B: {}",
        input.name, cable.name
    );
    let info = engine
        .start(EngineConfig {
            input_id: input.id.clone(),
            monitor_id: None,
            cable_id: Some(cable.id.clone()),
            buffer_ms: 10.0,
        })
        .map_err(anyhow::Error::msg)?;
    println!("\n{info:#?}\n");

    let mixer = engine.mixer.clone();
    for _ in 0..seconds * 4 {
        std::thread::sleep(Duration::from_millis(250));
        let input_ms = mixer.input_callback_frames.load(Ordering::Relaxed) as f32 * 1000.0
            / mixer.input_rate.load(Ordering::Relaxed).max(1) as f32;
        let out = &mixer.out_b;
        let buffered_ms = out.buffered_frames.load(Ordering::Relaxed) as f32 / 48.0;
        let out_ms = out.callback_frames.load(Ordering::Relaxed) as f32 * 1000.0
            / out.device_rate.load(Ordering::Relaxed).max(1) as f32;
        println!(
            "mic {:>6.1} dB | B {:>6.1} dB | Latenz {:>5.1} ms (ein {:.1} + puffer {:.1} + aus {:.1}) | underruns {} overruns {}",
            20.0 * mixer.channel(ChannelId::Mic).meter.take().max(1e-6).log10(),
            20.0 * out.meter.take().max(1e-6).log10(),
            input_ms + buffered_ms + out_ms,
            input_ms,
            buffered_ms,
            out_ms,
            out.underruns.load(Ordering::Relaxed),
            out.overruns.load(Ordering::Relaxed),
        );
    }
    let errors = engine.errors.lock().clone();
    if !errors.is_empty() {
        println!("Fehler: {errors:?}");
    }
    engine.stop();
    Ok(())
}
