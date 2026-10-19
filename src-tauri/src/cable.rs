//! Virtuelles Kabel (VB-Cable): erkennen und bei Bedarf installieren.
//!
//! VB-CABLE ist Donationware von VB-Audio (https://vb-audio.com/Cable/) und
//! darf laut VB-Audio mit Herkunftsangabe weitergegeben und still installiert
//! werden. Ode lädt das offizielle Treiberpaket und startet dessen Setup mit
//! Administratorrechten; Windows fragt dafür einmal nach.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use cpal::traits::HostTrait;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::audio::devices;
use crate::downloader::{download_file, hidden_command};

const CABLE_PAGE: &str = "https://vb-audio.com/Cable/";
const FALLBACK_PACK: &str =
    "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CableStatus {
    /// „CABLE Input“ ist als Ausgabegerät vorhanden.
    pub installed: bool,
    /// Windows hat das Kabel zum Standard-Lautsprecher gemacht (passiert beim
    /// Installieren): dann hört man am PC nichts mehr.
    pub default_output_is_cable: bool,
    pub installing: bool,
    pub step: Option<String>,
    pub progress: f32,
    pub error: Option<String>,
    /// Nach der Installation empfiehlt VB-Audio einen Neustart.
    pub restart_recommended: bool,
}

pub struct Cable {
    dir: PathBuf,
    state: Mutex<CableStatus>,
}

/// Höchste Paketnummer „VBCABLE_Driver_PackNN.zip“ in einer Seite.
fn newest_pack(page: &str) -> Option<String> {
    let mut best: Option<u32> = None;
    for (i, _) in page.match_indices("VBCABLE_Driver_Pack") {
        let rest = &page[i + "VBCABLE_Driver_Pack".len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>()
            && rest[digits.len()..].starts_with(".zip")
            && best.is_none_or(|b| n > b)
        {
            best = Some(n);
        }
    }
    best.map(|n| format!("https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack{n}.zip"))
}

/// Neueste Paket-URL von der VB-Audio-Seite, sonst die bekannte.
fn latest_pack_url() -> String {
    ureq::get(CABLE_PAGE)
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_to_string().ok())
        .and_then(|page| newest_pack(&page))
        .unwrap_or_else(|| FALLBACK_PACK.to_string())
}

fn extract(zip_path: &Path, dir: &Path) -> anyhow::Result<()> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path)?)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let target = dir.join(name);
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            std::io::copy(&mut entry, &mut File::create(&target)?)?;
        }
    }
    Ok(())
}

impl Cable {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("tools").join("vbcable"),
            state: Mutex::new(CableStatus::default()),
        }
    }

    pub fn status(&self) -> CableStatus {
        let host = cpal::default_host();
        let list = devices::list(&host).ok();
        let default = host
            .default_output_device()
            .map(|d| devices::name_of(&d))
            .unwrap_or_default();
        let mut state = self.state.lock();
        state.installed = list
            .as_ref()
            .is_some_and(|l| l.outputs.iter().any(|d| d.name.starts_with("CABLE Input")));
        state.default_output_is_cable = devices::is_virtual_cable(&default);
        state.clone()
    }

    fn set_step<R: Runtime>(&self, app: &AppHandle<R>, step: &str, progress: f32) {
        {
            let mut state = self.state.lock();
            state.step = Some(step.into());
            state.progress = progress;
        }
        let _ = app.emit("cable://status", self.status());
    }

    fn install_blocking<R: Runtime>(&self, app: &AppHandle<R>) -> anyhow::Result<()> {
        fs::create_dir_all(&self.dir)?;
        self.set_step(
            app,
            &crate::tr!("Treiberpaket wird geladen", "Downloading driver package"),
            0.0,
        );
        let zip_path = self.dir.with_extension("zip");
        download_file(&latest_pack_url(), &zip_path, |p| {
            self.set_step(
                app,
                &crate::tr!("Treiberpaket wird geladen", "Downloading driver package"),
                p,
            )
        })?;
        self.set_step(app, &crate::tr!("Wird entpackt", "Unpacking"), 1.0);
        extract(&zip_path, &self.dir)?;
        let _ = fs::remove_file(&zip_path);

        let setup = self.dir.join("VBCABLE_Setup_x64.exe");
        anyhow::ensure!(
            setup.is_file(),
            crate::tr!(
                "VBCABLE_Setup_x64.exe nicht im Paket",
                "VBCABLE_Setup_x64.exe missing from package"
            )
        );

        // Setup still (-i -h) mit Adminrechten; Windows zeigt die Abfrage.
        self.set_step(
            app,
            &crate::tr!(
                "Windows fragt nach Administratorrechten",
                "Windows asks for administrator rights"
            ),
            1.0,
        );
        let script = format!(
            "$p = Start-Process -FilePath '{}' -ArgumentList '-i','-h' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
            setup.display().to_string().replace('\'', "''")
        );
        let output = hidden_command(Path::new("powershell"))
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()?;
        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                if message.contains("abgebrochen") || message.contains("canceled") {
                    crate::tr!("Installation abgebrochen", "Installation cancelled")
                } else {
                    crate::tr!(
                        "Setup fehlgeschlagen: {}",
                        "Setup failed: {}",
                        message.trim()
                    )
                }
            );
        }

        // Windows braucht einen Moment, bis die neuen Geräte auftauchen.
        self.set_step(
            app,
            &crate::tr!("Warte auf das neue Gerät", "Waiting for the new device"),
            1.0,
        );
        for _ in 0..20 {
            if self.status().installed {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(500));
        }
        self.state.lock().restart_recommended = true;
        Ok(())
    }

    pub fn install<R: Runtime>(app: &AppHandle<R>) {
        let cable = app.state::<Cable>();
        {
            let mut state = cable.state.lock();
            if state.installing {
                return;
            }
            state.installing = true;
            state.error = None;
        }
        let app = app.clone();
        thread::spawn(move || {
            let cable = app.state::<Cable>();
            let result = cable.install_blocking(&app);
            {
                let mut state = cable.state.lock();
                state.installing = false;
                state.step = None;
                state.progress = 0.0;
                state.error = result.err().map(|e| e.to_string());
            }
            let _ = app.emit("cable://status", cable.status());
        });
    }
}

#[tauri::command]
pub fn cable_status(app: AppHandle) -> CableStatus {
    app.state::<Cable>().status()
}

#[tauri::command]
pub fn cable_install(app: AppHandle) {
    Cable::install(&app);
}

/// Öffnet die Windows-Soundeinstellungen (Standardgeräte wählen).
#[tauri::command]
pub fn open_sound_settings() -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg("ms-settings:sound")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_newest_pack() {
        let page = r#"<a href="x/VBCABLE_Driver_Pack43.zip"> <a href="x/VBCABLE_Driver_Pack45.zip"> VBCABLE_Driver_Pack99.txt"#;
        assert_eq!(
            newest_pack(page).as_deref(),
            Some("https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip")
        );
        assert_eq!(newest_pack("nichts"), None);
    }
}
