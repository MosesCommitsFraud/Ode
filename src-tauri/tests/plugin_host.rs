//! Ende-zu-Ende: Ode startet den echten Hilfsprozess (`ode --plugin-host`),
//! schickt die Stimme durch das eingebaute Test-Plugin und übersteht dessen
//! Absturz.

#![cfg(all(feature = "plugins", windows))]

use std::sync::Arc;
use std::time::{Duration, Instant};

use ode_lib::audio::mixer::Mixer;
use ode_lib::plugins::{Plugins, test_plugin};

fn host() -> (Arc<Mixer>, Plugins) {
    let mixer = Arc::new(Mixer::default());
    let plugins = Plugins::with_exe(mixer.clone(), env!("CARGO_BIN_EXE_ode"));
    (mixer, plugins)
}

/// Schickt ein paar Blöcke durch den Slot und liefert den letzten.
fn run_blocks(mixer: &Mixer, level: f32) -> Vec<f32> {
    let mut last = Vec::new();
    for _ in 0..20 {
        let mut buf = vec![level; 480];
        mixer.effects.insert.process(&mut buf);
        last = buf;
    }
    last
}

fn wait_for(mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

#[test]
fn voice_runs_through_the_helper_process_and_survives_a_crash() {
    let (mixer, plugins) = host();
    assert!(plugins.status().loaded.is_none());

    let status = plugins
        .load(test_plugin::PATH.into(), test_plugin::ID.into())
        .expect("Test-Plugin lädt im Hilfsprozess");
    assert_eq!(status.loaded.as_ref().unwrap().id, test_plugin::ID);
    assert!(status.crashed.is_none());

    // Gain 1: unverändert durch den anderen Prozess und zurück.
    let out = run_blocks(&mixer, 0.5);
    assert!(
        out.iter().all(|&s| (s - 0.5).abs() < 1e-6),
        "{:?}",
        &out[..4]
    );

    // Parameter halbiert den Pegel.
    plugins.set_param(test_plugin::GAIN, 0.5).unwrap();
    assert!(wait_for(|| run_blocks(&mixer, 0.5)
        .iter()
        .all(|&s| (s - 0.25).abs() < 1e-6)));
    let params = plugins.params().unwrap();
    assert_eq!(params[0].name, "Gain");

    // Absturz: der Hilfsprozess stirbt, die Stimme läuft trocken weiter.
    plugins.kill_host();
    assert!(
        wait_for(|| plugins.status().crashed.is_some()),
        "Absturz wird gemeldet"
    );
    let status = plugins.status();
    assert!(status.loaded.is_none());
    assert_eq!(status.last.as_ref().unwrap().id, test_plugin::ID);
    let out = run_blocks(&mixer, 0.5);
    assert!(out.iter().all(|&s| s == 0.5));

    // Neu laden startet einen frischen Hilfsprozess.
    let status = plugins
        .load(test_plugin::PATH.into(), test_plugin::ID.into())
        .expect("Neu laden nach Absturz");
    assert!(status.crashed.is_none());
    let out = run_blocks(&mixer, 0.5);
    assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6));

    // Entfernen beendet den Hilfsprozess und leert den Slot.
    plugins.unload();
    assert!(!mixer.effects.insert.is_filled());
    assert!(plugins.status().loaded.is_none());
}

#[test]
fn a_broken_plugin_file_does_not_take_ode_down() {
    let (_mixer, plugins) = host();
    let dir = std::env::temp_dir().join(format!("ode-broken-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("kaputt.clap");
    std::fs::write(&file, b"kein Plugin").unwrap();
    let result = plugins.entries(file.to_string_lossy().into_owned());
    assert!(result.is_err());
    // Ode lebt weiter und kann danach normal laden.
    assert!(
        plugins
            .load(test_plugin::PATH.into(), test_plugin::ID.into())
            .is_ok()
    );
    plugins.unload();
    let _ = std::fs::remove_dir_all(dir);
}
