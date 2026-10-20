//! Ode-Seite des Plugin-Hilfsprozesses. Startet `ode --plugin-host`
//! unsichtbar, schickt ihm Anfragen und setzt einen Einschub in den
//! Plugin-Slot, der jeden Block über den gemeinsamen Speicher hin- und
//! zurückschickt. Stürzt der Hilfsprozess ab oder hängt er, läuft die Stimme
//! trocken weiter: Der Wächter räumt den Slot, meldet es, und die nächste
//! Aktion startet einen neuen Hilfsprozess.

use std::any::Any;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use crossbeam_channel::{Receiver, RecvTimeoutError, unbounded};
use parking_lot::Mutex;
use serde::de::DeserializeOwned;

use super::shm::{RoundTrip, SharedAudio};
use super::{ParamDesc, PluginInfo, PluginStatus, Request, Response};
use crate::audio::insert::Insert;
use crate::audio::mixer::Mixer;

/// Kein Konsolenfenster für den Hilfsprozess.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// So lange wartet der Audio-Thread höchstens auf einen Block.
const BLOCK_TIMEOUT: Duration = Duration::from_millis(4);
/// So viele Blöcke ohne Antwort in Folge (≈ 1 s) gelten als Hänger.
const HUNG_BLOCKS: u32 = 100;

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// Der Einschub in Odes Plugin-Slot.
struct RemoteInsert {
    shm: Arc<SharedAudio>,
    alive: Arc<AtomicBool>,
    /// Blöcke ohne rechtzeitige Antwort in Folge.
    misses: Arc<AtomicU32>,
}

impl Insert for RemoteInsert {
    fn process(&mut self, buf: &mut [f32]) {
        if !self.alive.load(Ordering::Relaxed) {
            return;
        }
        for chunk in buf.chunks_mut(super::shm::MAX_FRAMES) {
            match self.shm.round_trip(chunk, BLOCK_TIMEOUT) {
                RoundTrip::Done => self.misses.store(0, Ordering::Relaxed),
                RoundTrip::Busy | RoundTrip::Timeout => {
                    self.misses.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any + Send> {
        self
    }
}

/// Ein laufender Hilfsprozess.
struct Connection {
    stdin: ChildStdin,
    responses: Receiver<String>,
    child: Arc<Mutex<Child>>,
    shm: Arc<SharedAudio>,
    alive: Arc<AtomicBool>,
    misses: Arc<AtomicU32>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Als Tauri-State verwaltet.
pub struct PluginHost {
    mixer: Arc<Mixer>,
    exe: PathBuf,
    connection: Mutex<Option<Connection>>,
    /// Warum der Hilfsprozess zuletzt beendet wurde, für die Oberfläche.
    crashed: Arc<Mutex<Option<String>>>,
    /// Zuletzt geladenes Plugin, zum Neu-Laden nach einem Absturz.
    last: Arc<Mutex<Option<PluginInfo>>>,
}

fn dead() -> String {
    crate::tr!(
        "Der Plugin-Prozess ist beendet",
        "The plugin process has ended"
    )
}

impl PluginHost {
    pub fn spawn(mixer: Arc<Mixer>) -> Self {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("ode.exe"));
        Self::with_exe(mixer, exe)
    }

    /// Mit einer bestimmten Programmdatei, z. B. in Tests.
    pub fn with_exe(mixer: Arc<Mixer>, exe: impl Into<PathBuf>) -> Self {
        Self {
            mixer,
            exe: exe.into(),
            connection: Mutex::new(None),
            crashed: Arc::new(Mutex::new(None)),
            last: Arc::new(Mutex::new(None)),
        }
    }

    fn connect(&self) -> Result<Connection, String> {
        let name = format!(
            "ode-plugins-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        );
        let shm = Arc::new(SharedAudio::create(&name)?);
        let mut child = Command::new(&self.exe)
            .arg("--plugin-host")
            .arg(&name)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| {
                crate::tr!(
                    "Plugin-Prozess startet nicht: {e}",
                    "Plugin process does not start: {e}"
                )
            })?;
        let stdin = child.stdin.take().ok_or_else(dead)?;
        let stdout = child.stdout.take().ok_or_else(dead)?;

        let (tx, responses) = unbounded();
        thread::Builder::new()
            .name("ode-plugin-replies".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let connection = Connection {
            stdin,
            responses,
            child: Arc::new(Mutex::new(child)),
            shm,
            alive: Arc::new(AtomicBool::new(true)),
            misses: Arc::new(AtomicU32::new(0)),
        };
        self.watch(&connection);
        *self.crashed.lock() = None;
        Ok(connection)
    }

    /// Wächter: merkt Absturz und Hänger, räumt dann den Slot.
    fn watch(&self, connection: &Connection) {
        let child = connection.child.clone();
        let alive = connection.alive.clone();
        let misses = connection.misses.clone();
        let crashed = self.crashed.clone();
        let last = self.last.clone();
        let mixer = self.mixer.clone();
        let _ = thread::Builder::new()
            .name("ode-plugin-watch".into())
            .spawn(move || {
                let mut hung = false;
                loop {
                    thread::sleep(Duration::from_millis(100));
                    if !alive.load(Ordering::Relaxed) {
                        // Absichtlich beendet (Entladen, Ode schließt).
                        return;
                    }
                    if !hung && misses.load(Ordering::Relaxed) >= HUNG_BLOCKS {
                        hung = true;
                        let _ = child.lock().kill();
                    }
                    let exited = child.lock().try_wait().ok().flatten();
                    let Some(status) = exited else { continue };
                    alive.store(false, Ordering::Relaxed);
                    mixer.effects.insert.replace(None);
                    let name = last
                        .lock()
                        .as_ref()
                        .map(|p| p.name.clone())
                        .unwrap_or_default();
                    let message = if hung {
                        crate::tr!(
                            "{name} reagiert nicht mehr und wurde beendet. Deine Stimme läuft ohne Plugin weiter.",
                            "{name} stopped responding and was closed. Your voice continues without the plugin."
                        )
                    } else {
                        let code = status.code().map(|c| format!("{c:#x}")).unwrap_or_default();
                        crate::tr!(
                            "{name} ist abgestürzt ({code}). Deine Stimme läuft ohne Plugin weiter.",
                            "{name} crashed ({code}). Your voice continues without the plugin."
                        )
                    };
                    *crashed.lock() = Some(message);
                    return;
                }
            });
    }

    /// Schickt eine Anfrage; startet den Hilfsprozess bei Bedarf (neu).
    fn request<T: DeserializeOwned>(
        &self,
        request: &Request,
        timeout: Duration,
    ) -> Result<T, String> {
        let mut guard = self.connection.lock();
        if guard
            .as_ref()
            .is_none_or(|c| !c.alive.load(Ordering::Relaxed))
        {
            *guard = None;
            *guard = Some(self.connect()?);
        }
        let connection = guard.as_mut().ok_or_else(dead)?;
        let line = serde_json::to_string(request).map_err(|e| e.to_string())?;
        let sent = writeln!(connection.stdin, "{line}").and_then(|_| connection.stdin.flush());
        let reply = match sent {
            Ok(()) => connection.responses.recv_timeout(timeout),
            Err(_) => Err(RecvTimeoutError::Disconnected),
        };
        let line = match reply {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => {
                // Hängt im Main-Thread (z. B. beim Laden): beenden statt warten.
                let _ = connection.child.lock().kill();
                return Err(crate::tr!(
                    "Der Plugin-Prozess antwortet nicht und wurde beendet",
                    "The plugin process does not respond and was closed"
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                // Der Wächter meldet gleich, warum.
                thread::sleep(Duration::from_millis(250));
                return Err(self.crashed.lock().clone().unwrap_or_else(dead));
            }
        };
        match serde_json::from_str::<Response>(&line).map_err(|e| e.to_string())? {
            Response::Ok(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
            Response::Err(e) => Err(e),
        }
    }

    fn connected(&self) -> bool {
        self.connection
            .lock()
            .as_ref()
            .is_some_and(|c| c.alive.load(Ordering::Relaxed))
    }

    /// Ergänzt, was nur Ode weiß: Bypass, Rechenzeit, Absturz.
    fn finish(&self, mut status: PluginStatus) -> PluginStatus {
        let slot = &self.mixer.effects.insert;
        status.available = true;
        status.bypass = slot.bypass.load(Ordering::Relaxed);
        if status.loaded.is_some() {
            // Gemessen in Ode: Hin- und Rückweg samt Plugin.
            status.load_ms = slot.load_ms.load();
        }
        status.crashed = self.crashed.lock().clone();
        status.last = self.last.lock().clone();
        status
    }

    pub fn status(&self) -> PluginStatus {
        // Für den Status keinen Hilfsprozess starten.
        if !self.connected() {
            return self.finish(PluginStatus::default());
        }
        let status = self
            .request(&Request::Status, Duration::from_secs(5))
            .unwrap_or_default();
        self.finish(status)
    }

    pub fn scan(&self) -> Result<Vec<PluginInfo>, String> {
        // Beim Suchen werden fremde Bibliotheken geladen; ein Absturz trifft
        // nur den Hilfsprozess.
        self.request(&Request::Scan, Duration::from_secs(120))
    }

    pub fn entries(&self, path: String) -> Result<Vec<PluginInfo>, String> {
        self.request(&Request::Entries { path }, Duration::from_secs(30))
    }

    pub fn load(&self, path: String, id: String) -> Result<PluginStatus, String> {
        self.mixer.effects.insert.replace(None);
        let status: PluginStatus =
            self.request(&Request::Load { path, id }, Duration::from_secs(30))?;
        *self.last.lock() = status.loaded.clone();
        let insert = {
            let guard = self.connection.lock();
            let connection = guard.as_ref().ok_or_else(dead)?;
            connection.misses.store(0, Ordering::Relaxed);
            RemoteInsert {
                shm: connection.shm.clone(),
                alive: connection.alive.clone(),
                misses: connection.misses.clone(),
            }
        };
        self.mixer.effects.insert.replace(Some(Box::new(insert)));
        Ok(self.finish(status))
    }

    pub fn unload(&self) {
        self.mixer.effects.insert.replace(None);
        *self.last.lock() = None;
        *self.crashed.lock() = None;
        // Hilfsprozess ganz beenden: Ein leerer Slot braucht keinen.
        *self.connection.lock() = None;
    }

    pub fn params(&self) -> Result<Vec<ParamDesc>, String> {
        if !self.connected() {
            return Ok(Vec::new());
        }
        self.request(&Request::Params, Duration::from_secs(5))
    }

    pub fn set_param(&self, id: u32, value: f64) -> Result<(), String> {
        if !self.connected() {
            return Err(dead());
        }
        self.request(&Request::SetParam { id, value }, Duration::from_secs(5))
    }

    pub fn set_bypass(&self, on: bool) {
        self.mixer
            .effects
            .insert
            .bypass
            .store(on, Ordering::Relaxed);
    }

    pub fn gui(&self, open: bool) -> Result<PluginStatus, String> {
        if !self.connected() {
            return Err(dead());
        }
        let status = self.request(&Request::Gui { open }, Duration::from_secs(15))?;
        Ok(self.finish(status))
    }

    /// Beendet den Hilfsprozess hart, wie bei einem Absturz. Für Tests.
    #[doc(hidden)]
    pub fn kill_host(&self) {
        if let Some(connection) = self.connection.lock().as_ref() {
            let _ = connection.child.lock().kill();
        }
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        self.mixer.effects.insert.replace(None);
    }
}
