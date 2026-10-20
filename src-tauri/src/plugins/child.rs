//! Der Plugin-Hilfsprozess: `ode --plugin-host <name>`. Ode startet ihn
//! unsichtbar und steuert ihn über stdin/stdout (eine JSON-Zeile je Anfrage
//! und Antwort); das Audio läuft über den gemeinsamen Speicher `<name>`.
//! Endet stdin (Ode beendet oder abgestürzt), beendet er sich auch.

use std::io::{BufRead, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use crossbeam_channel::unbounded;
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};

use super::clap::Worker;
use super::shm::SharedAudio;
use super::{Request, Response};
use crate::audio::insert::InsertSlot;

/// Läuft bis zum Ende von stdin; liefert den Exit-Code.
pub fn run(name: &str) -> i32 {
    let shm = match SharedAudio::open(name) {
        Ok(shm) => Arc::new(shm),
        Err(e) => {
            eprintln!("ode plugin host: {e}");
            return 2;
        }
    };
    let slot = Arc::new(InsertSlot::default());
    let stop = Arc::new(AtomicBool::new(false));

    // Audio: wartet auf Blöcke von Ode und schickt sie durch den Slot.
    let audio = {
        let (shm, slot, stop) = (shm.clone(), slot.clone(), stop.clone());
        thread::Builder::new()
            .name("ode-plugin-audio".into())
            .spawn(move || {
                unsafe {
                    let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
                }
                shm.serve(&stop, |buf| slot.process(buf));
            })
            .expect("Audio-Thread konnte nicht starten")
    };

    // Anfragen von stdin; ein eigener Thread, damit die Nachrichtenschleife
    // der Plugin-Fenster nie blockiert.
    let (tx, rx) = unbounded();
    thread::Builder::new()
        .name("ode-plugin-stdin".into())
        .spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let request = serde_json::from_str::<Request>(&line).map_err(|e| e.to_string());
                if tx.send(request).is_err() {
                    break;
                }
            }
        })
        .expect("Eingabe-Thread konnte nicht starten");

    let mut out = std::io::stdout().lock();
    Worker::new(slot).run(rx, |result| {
        let response = match result {
            Ok(value) => Response::Ok(value),
            Err(e) => Response::Err(e),
        };
        if let Ok(line) = serde_json::to_string(&response) {
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        }
    });

    stop.store(true, Ordering::Relaxed);
    let _ = audio.join();
    0
}
