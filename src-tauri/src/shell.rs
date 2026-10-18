//! Rund ums Fenster: Tray-Symbol, Weiterlaufen im Tray, Autostart, nur eine
//! Instanz und allgemeine App-Einstellungen.

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::audio::engine::Engine;
use crate::audio::sampler::SamplerCommand;
use crate::library::Library;
use crate::music::Player;

const SETTINGS_KEY: &str = "app";
/// Mit diesem Argument startet Ode per Autostart unsichtbar im Tray.
pub const MINIMIZED_ARG: &str = "--minimized";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Schließen versteckt das Fenster nur; Ode läuft im Tray weiter.
    pub close_to_tray: bool,
    /// Mit Windows starten (im Tray).
    pub autostart: bool,
    /// Einrichtungsassistent wurde abgeschlossen.
    pub setup_done: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            autostart: false,
            setup_done: false,
        }
    }
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    let mut settings: AppSettings = app
        .state::<Library>()
        .setting(SETTINGS_KEY)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    settings.autostart = app.autolaunch().is_enabled().unwrap_or(false);
    settings
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> anyhow::Result<()> {
    app.state::<Library>()
        .set_setting(SETTINGS_KEY, &serde_json::to_string(settings)?)
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Tray-Symbol mit Menü; Linksklick öffnet das Fenster.
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ode öffnen", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Alle Sounds stoppen", true, None::<&str>)?;
    let music = MenuItem::with_id(app, "music", "Musik Pause/Weiter", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &stop, &music, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ode")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "stop" => {
                let _ = app.state::<Engine>().sampler(SamplerCommand::StopAll);
            }
            "music" => app.state::<Player>().toggle(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Schließen versteckt das Fenster, solange „im Tray weiterlaufen“ an ist.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && window.label() == "main"
        && load(window.app_handle()).close_to_tray
    {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// Fenster beim Start zeigen, außer beim Autostart.
pub fn show_on_start<R: Runtime>(app: &AppHandle<R>) {
    if !std::env::args().any(|a| a == MINIMIZED_ARG) {
        show_main(app);
    }
}

#[tauri::command]
pub fn app_settings(app: AppHandle) -> AppSettings {
    load(&app)
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let autolaunch = app.autolaunch();
    let result = if settings.autostart {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|e| format!("Autostart: {e}"))?;
    save(&app, &settings).map_err(|e| e.to_string())?;
    Ok(load(&app))
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
