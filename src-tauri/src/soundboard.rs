//! Tauri-Befehle für Soundboard und globale Hotkeys.

use std::collections::HashMap;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::audio::engine::Engine;
use crate::audio::sampler::SamplerCommand;
use crate::library::{Library, Sound, SoundPatch};

/// Hotkey-ID → Sound-ID.
#[derive(Default)]
pub struct Hotkeys(Mutex<HashMap<u32, i64>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn play<R: Runtime>(app: &AppHandle<R>, id: i64) -> Result<(), String> {
    let library = app.state::<Library>();
    let sound = library.get(id).map_err(err)?;
    let request = library.play_request(&sound).map_err(err)?;
    app.state::<Engine>().sampler(SamplerCommand::Play(request))
}

/// Plugin mit Handler: Hotkeys spielen den zugeordneten Sound.
pub fn hotkey_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let id = app.state::<Hotkeys>().0.lock().get(&shortcut.id()).copied();
            if let Some(id) = id {
                let _ = play(app, id);
            }
        })
        .build()
}

/// Meldet alle Hotkeys neu an; liefert Fehler für belegte oder ungültige.
pub fn sync_hotkeys<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let hotkeys = app.state::<Hotkeys>();
    let mut map = hotkeys.0.lock();
    map.clear();

    let mut errors = Vec::new();
    for sound in app.state::<Library>().list().unwrap_or_default() {
        let Some(hotkey) = &sound.hotkey else {
            continue;
        };
        let shortcut: Shortcut = match hotkey.parse() {
            Ok(s) => s,
            Err(_) => {
                errors.push(crate::tr!(
                    "{}: Hotkey „{hotkey}“ ist ungültig",
                    "{}: hotkey “{hotkey}” is invalid",
                    sound.name
                ));
                continue;
            }
        };
        if map.contains_key(&shortcut.id()) {
            errors.push(crate::tr!(
                "{}: „{hotkey}“ ist schon vergeben",
                "{}: “{hotkey}” is already in use",
                sound.name
            ));
            continue;
        }
        match shortcuts.register(shortcut) {
            Ok(()) => {
                map.insert(shortcut.id(), sound.id);
            }
            Err(_) => errors.push(crate::tr!(
                "{}: „{hotkey}“ wird von einem anderen Programm benutzt",
                "{}: “{hotkey}” is used by another program",
                sound.name
            )),
        }
    }
    errors
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    sounds: Vec<Sound>,
    errors: Vec<String>,
}

#[tauri::command]
pub fn library_list(library: State<Library>) -> Result<Vec<Sound>, String> {
    library.list().map_err(err)
}

#[tauri::command]
pub async fn library_import(
    library: State<'_, Library>,
    tools: State<'_, crate::downloader::Tools>,
    paths: Vec<PathBuf>,
) -> Result<ImportResult, String> {
    let mut sounds = Vec::new();
    let mut errors = Vec::new();
    // Eingebettete Cover mit FFmpeg zuschneiden, falls schon installiert.
    let meta = crate::covers::ImportMeta {
        ffmpeg: Some(tools.ffmpeg()),
        ..Default::default()
    };
    for path in paths {
        match library.import_with(&path, &meta) {
            Ok(sound) => sounds.push(sound),
            Err(e) => errors.push(format!(
                "{}: {e}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    Ok(ImportResult { sounds, errors })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    sound: Sound,
    hotkey_errors: Vec<String>,
}

#[tauri::command]
pub fn library_update(
    app: AppHandle,
    library: State<Library>,
    id: i64,
    patch: SoundPatch,
) -> Result<UpdateResult, String> {
    let hotkey_changed = patch.hotkey.is_some();
    let sound = library.update(id, patch).map_err(err)?;
    let hotkey_errors = if hotkey_changed {
        sync_hotkeys(&app)
    } else {
        Vec::new()
    };
    Ok(UpdateResult {
        sound,
        hotkey_errors,
    })
}

#[tauri::command]
pub fn library_delete(app: AppHandle, library: State<Library>, id: i64) -> Result<(), String> {
    let _ = app.state::<Engine>().sampler(SamplerCommand::Stop(id));
    library.delete(id).map_err(err)?;
    sync_hotkeys(&app);
    Ok(())
}

#[tauri::command]
pub fn hotkey_errors(app: AppHandle) -> Vec<String> {
    sync_hotkeys(&app)
}

#[tauri::command]
pub fn sound_play(app: AppHandle, id: i64) -> Result<(), String> {
    play(&app, id)
}

/// Spielt einen Sound nur auf dem Kopfhörer, z. B. beim Zuschneiden im Editor.
#[tauri::command]
pub fn sound_preview(app: AppHandle, id: i64) -> Result<(), String> {
    let library = app.state::<Library>();
    let sound = library.get(id).map_err(err)?;
    let request = library.play_request(&sound).map_err(err)?;
    let engine = app.state::<Engine>();
    // Ein Vorhören ersetzt das vorige.
    let _ = engine.preview(SamplerCommand::StopAll);
    engine.preview(SamplerCommand::Play(request))
}

#[tauri::command]
pub fn sound_stop(engine: State<Engine>, id: i64) -> Result<(), String> {
    let _ = engine.preview(SamplerCommand::Stop(id));
    engine.sampler(SamplerCommand::Stop(id))
}

#[tauri::command]
pub fn sound_stop_all(engine: State<Engine>) -> Result<(), String> {
    let _ = engine.preview(SamplerCommand::StopAll);
    engine.sampler(SamplerCommand::StopAll)
}
