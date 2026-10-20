//! Externe Effekt-Plugins (Prototyp). Mit dem Cargo-Feature `plugins` lädt
//! Ode CLAP-Plugins in einen unsichtbaren Hilfsprozess (`ode --plugin-host`)
//! und schickt die Stimme im Plugin-Slot der Mikrofon-Kette (siehe
//! `audio::insert`) dort hindurch. Stürzt ein Plugin ab, trifft es nur den
//! Hilfsprozess. Ohne das Feature melden die Befehle nur, dass es nicht
//! eingebaut ist. Hintergrund und offene Punkte: docs/plugins.md.

#[cfg(all(feature = "plugins", windows))]
mod child;
#[cfg(all(feature = "plugins", windows))]
mod clap;
#[cfg(all(feature = "plugins", windows))]
mod remote;
#[cfg(all(feature = "plugins", windows))]
mod shm;
#[cfg(all(feature = "plugins", windows))]
pub mod test_plugin;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Ein Plugin in einer Bibliotheksdatei.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub path: String,
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub version: String,
}

/// Ein Parameter des geladenen Plugins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamDesc {
    pub id: u32,
    pub name: String,
    /// Gruppe, z. B. „Filter/Hüllkurve“.
    pub module: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub value: f64,
    /// Anzeige des Plugins, z. B. „-6.0 dB“.
    pub text: String,
    /// Nur ganze Werte (Schalter, Auswahl).
    pub stepped: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginStatus {
    /// In diesen Build eingebaut.
    pub available: bool,
    pub loaded: Option<PluginInfo>,
    pub bypass: bool,
    /// Das Plugin hat ein eigenes Fenster.
    pub has_gui: bool,
    pub gui_open: bool,
    /// Vom Plugin gemeldete Verzögerung.
    pub latency_ms: f32,
    /// Rechenzeit des Plugins im letzten Block (in Ode: Hin- und Rückweg).
    pub load_ms: f32,
    /// Der Hilfsprozess ist abgestürzt oder hing; die Meldung dazu.
    pub crashed: Option<String>,
    /// Zuletzt geladenes Plugin, zum Neu-Laden nach einem Absturz.
    pub last: Option<PluginInfo>,
}

/// Anfrage an den Hilfsprozess, eine JSON-Zeile auf seinem stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
pub enum Request {
    Status,
    Scan,
    Entries { path: String },
    Load { path: String, id: String },
    Unload,
    Params,
    SetParam { id: u32, value: f64 },
    Gui { open: bool },
}

/// Antwort des Hilfsprozesses, eine JSON-Zeile auf seinem stdout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Response {
    Ok(serde_json::Value),
    Err(String),
}

/// Einstieg für `ode --plugin-host <name>`; liefert den Exit-Code.
pub fn host_main(name: Option<&str>) -> i32 {
    #[cfg(all(feature = "plugins", windows))]
    {
        match name {
            Some(name) => child::run(name),
            None => 2,
        }
    }
    #[cfg(not(all(feature = "plugins", windows)))]
    {
        let _ = name;
        1
    }
}

#[cfg(all(feature = "plugins", windows))]
pub use remote::PluginHost as Plugins;

/// Platzhalter, wenn das Feature fehlt.
#[cfg(not(all(feature = "plugins", windows)))]
pub struct Plugins;

#[cfg(not(all(feature = "plugins", windows)))]
impl Plugins {
    pub fn spawn(_mixer: std::sync::Arc<crate::audio::mixer::Mixer>) -> Self {
        Self
    }

    fn unavailable<T>(&self) -> Result<T, String> {
        Err(crate::tr!(
            "Plugins sind in diesem Build nicht enthalten",
            "Plugins are not included in this build"
        ))
    }

    pub fn status(&self) -> PluginStatus {
        PluginStatus::default()
    }

    pub fn scan(&self) -> Result<Vec<PluginInfo>, String> {
        self.unavailable()
    }

    pub fn entries(&self, _path: String) -> Result<Vec<PluginInfo>, String> {
        self.unavailable()
    }

    pub fn load(&self, _path: String, _id: String) -> Result<PluginStatus, String> {
        self.unavailable()
    }

    pub fn unload(&self) {}

    pub fn params(&self) -> Result<Vec<ParamDesc>, String> {
        self.unavailable()
    }

    pub fn set_param(&self, _id: u32, _value: f64) -> Result<(), String> {
        self.unavailable()
    }

    pub fn set_bypass(&self, _on: bool) {}

    pub fn gui(&self, _open: bool) -> Result<PluginStatus, String> {
        self.unavailable()
    }
}

#[tauri::command]
pub fn plugins_status(plugins: State<Plugins>) -> PluginStatus {
    plugins.status()
}

/// Sucht in den Standard-Ordnern für CLAP-Plugins.
#[tauri::command]
pub async fn plugins_scan(plugins: State<'_, Plugins>) -> Result<Vec<PluginInfo>, String> {
    plugins.scan()
}

/// Plugins in einer selbst gewählten Datei.
#[tauri::command]
pub async fn plugins_entries(
    plugins: State<'_, Plugins>,
    path: String,
) -> Result<Vec<PluginInfo>, String> {
    plugins.entries(path)
}

#[tauri::command]
pub async fn plugin_load(
    plugins: State<'_, Plugins>,
    path: String,
    id: String,
) -> Result<PluginStatus, String> {
    plugins.load(path, id)
}

#[tauri::command]
pub fn plugin_unload(plugins: State<Plugins>) -> PluginStatus {
    plugins.unload();
    plugins.status()
}

#[tauri::command]
pub fn plugin_params(plugins: State<Plugins>) -> Result<Vec<ParamDesc>, String> {
    plugins.params()
}

#[tauri::command]
pub fn plugin_set_param(plugins: State<Plugins>, id: u32, value: f64) -> Result<(), String> {
    plugins.set_param(id, value)
}

#[tauri::command]
pub fn plugin_bypass(plugins: State<Plugins>, on: bool) -> PluginStatus {
    plugins.set_bypass(on);
    plugins.status()
}

#[tauri::command]
pub fn plugin_gui(plugins: State<Plugins>, open: bool) -> Result<PluginStatus, String> {
    plugins.gui(open)
}
