//! Stimm-Presets: gespeicherte Einstellungen der Stimm-Effekte, per Klick
//! oder globalem Hotkey umschaltbar. Ein zweiter Druck auf den Hotkey des
//! aktiven Presets schaltet die Stimm-Effekte wieder aus.

use std::sync::atomic::Ordering;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::MixerDirty;
use crate::audio::effects::EffectsParams;
use crate::audio::engine::Engine;
use crate::audio::voice::character::{CharacterMode, CharacterParams};
use crate::audio::voice::modulation::{ModulationMode, ModulationParams};
use crate::audio::voice::space::{EchoParams, ReverbParams};
use crate::audio::voice::vocoder::{Chord, VocoderParams};
use crate::audio::voice::{
    AutotuneParams, HarmonizerParams, HarmonyVoice, PitchParams, Scale, VoiceParams,
};
use crate::library::Library;

const PRESETS_KEY: &str = "voice_presets";
const ACTIVE_KEY: &str = "voice_preset_active";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    /// Leer bei mitgelieferten Presets, solange sie nicht umbenannt wurden;
    /// die Oberfläche zeigt dann den übersetzten Namen.
    #[serde(default)]
    pub name: String,
    /// Name eines Symbols der Oberfläche.
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub builtin: bool,
    pub voice: VoiceParams,
}

#[derive(Default)]
pub struct Presets {
    list: Mutex<Vec<Preset>>,
    active: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetState {
    presets: Vec<Preset>,
    active: Option<String>,
}

/// Geht an die Oberfläche, wenn ein Preset (z. B. per Hotkey) wechselt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceChanged {
    effects: EffectsParams,
    active: Option<String>,
}

fn voice(build: impl FnOnce(&mut VoiceParams)) -> VoiceParams {
    let mut v = VoiceParams::default();
    build(&mut v);
    v
}

fn builtin(id: &str, icon: &str, build: impl FnOnce(&mut VoiceParams)) -> Preset {
    Preset {
        id: id.into(),
        name: String::new(),
        icon: icon.into(),
        hotkey: None,
        builtin: true,
        voice: voice(build),
    }
}

/// Deutscher und englischer Name der mitgelieferten Presets.
fn builtin_name(id: &str) -> Option<(&'static str, &'static str)> {
    Some(match id {
        "helium" => ("Helium", "Helium"),
        "giant" => ("Riese", "Giant"),
        "demon" => ("Dämon", "Demon"),
        "robot" => ("Roboter", "Robot"),
        "radio" => ("Funkgerät", "Radio"),
        "phone" => ("Telefon", "Telephone"),
        "megaphone" => ("Megafon", "Megaphone"),
        "cave" => ("Höhle", "Cave"),
        "cathedral" => ("Kathedrale", "Cathedral"),
        "hard-tune" => ("Autotune hart", "Hard tune"),
        "soft-tune" => ("Autotune sanft", "Soft tune"),
        "choir" => ("Chor", "Choir"),
        "vocoder" => ("Vocoder", "Vocoder"),
        "alien" => ("Alien", "Alien"),
        "ghost" => ("Geist", "Ghost"),
        "lofi" => ("Lo-Fi", "Lo-fi"),
        _ => return None,
    })
}

pub fn display_name(preset: &Preset) -> String {
    if !preset.name.is_empty() {
        return preset.name.clone();
    }
    match builtin_name(&preset.id) {
        Some((de, en)) => {
            if crate::i18n::english() {
                en.into()
            } else {
                de.into()
            }
        }
        None => preset.id.clone(),
    }
}

fn reverb(size: f32, damping: f32, predelay_ms: f32, mix: f32) -> ReverbParams {
    ReverbParams {
        enabled: true,
        size,
        damping,
        predelay_ms,
        low_cut_hz: 200.0,
        mix,
    }
}

fn character(mode: CharacterMode, amount: f32, tone: f32) -> CharacterParams {
    CharacterParams {
        enabled: true,
        mode,
        amount,
        tone,
        mix: 1.0,
    }
}

fn modulation(mode: ModulationMode, rate_hz: f32, depth: f32, mix: f32) -> ModulationParams {
    ModulationParams {
        enabled: true,
        mode,
        rate_hz,
        depth,
        feedback: 0.5,
        mix,
    }
}

fn shift(semitones: f32, formant: f32) -> PitchParams {
    PitchParams {
        enabled: true,
        semitones,
        formant,
    }
}

pub fn builtins() -> Vec<Preset> {
    vec![
        builtin("helium", "balloon", |v| v.pitch = shift(8.0, 5.0)),
        builtin("giant", "person", |v| {
            v.pitch = shift(-5.0, -4.0);
            v.reverb = reverb(0.5, 0.6, 10.0, 0.15);
        }),
        builtin("demon", "skull", |v| {
            v.pitch = shift(-9.0, -3.0);
            v.character = character(CharacterMode::Distortion, 0.25, 0.4);
            v.reverb = reverb(0.7, 0.5, 20.0, 0.25);
        }),
        builtin("robot", "robot", |v| {
            v.character = character(CharacterMode::Robot, 0.85, 0.25);
        }),
        builtin("radio", "radio", |v| {
            v.character = character(CharacterMode::Radio, 0.5, 0.4);
        }),
        builtin("phone", "phone", |v| {
            v.character = character(CharacterMode::Telephone, 0.4, 0.2);
        }),
        builtin("megaphone", "megaphone", |v| {
            v.character = character(CharacterMode::Megaphone, 0.6, 0.6);
            v.reverb = reverb(0.4, 0.5, 15.0, 0.15);
        }),
        builtin("cave", "mountains", |v| {
            v.reverb = reverb(0.92, 0.3, 45.0, 0.45);
            v.echo = EchoParams {
                enabled: true,
                time_ms: 190.0,
                feedback: 0.3,
                tone_hz: 2_500.0,
                mix: 0.25,
            };
        }),
        builtin("cathedral", "church", |v| {
            v.reverb = reverb(1.0, 0.2, 70.0, 0.55);
        }),
        builtin("hard-tune", "music-notes", |v| {
            v.autotune = AutotuneParams {
                enabled: true,
                key: 0,
                scale: Scale::Chromatic,
                speed: 0.0,
            };
            v.reverb = reverb(0.4, 0.4, 20.0, 0.12);
        }),
        builtin("soft-tune", "music-note", |v| {
            v.autotune = AutotuneParams {
                enabled: true,
                key: 0,
                scale: Scale::Chromatic,
                speed: 0.55,
            };
        }),
        builtin("choir", "users-three", |v| {
            v.harmonizer = HarmonizerParams {
                enabled: true,
                voices: [
                    HarmonyVoice {
                        enabled: true,
                        semitones: 4.0,
                        level: 0.55,
                    },
                    HarmonyVoice {
                        enabled: true,
                        semitones: -5.0,
                        level: 0.5,
                    },
                ],
            };
            v.modulation = modulation(ModulationMode::Chorus, 0.6, 0.5, 0.35);
            v.reverb = reverb(0.75, 0.4, 30.0, 0.3);
        }),
        builtin("vocoder", "piano-keys", |v| {
            v.vocoder = VocoderParams {
                enabled: true,
                note: 48.0,
                follow: true,
                chord: Chord::Fifth,
                breath: 0.15,
                mix: 1.0,
            };
            v.modulation = modulation(ModulationMode::Chorus, 0.4, 0.4, 0.3);
        }),
        builtin("alien", "alien", |v| {
            v.pitch = shift(3.0, 6.0);
            v.modulation = modulation(ModulationMode::Flanger, 0.35, 0.8, 0.6);
        }),
        builtin("ghost", "ghost", |v| {
            v.pitch = shift(-2.0, 0.0);
            v.modulation = modulation(ModulationMode::Chorus, 0.3, 0.8, 0.5);
            v.echo = EchoParams {
                enabled: true,
                time_ms: 420.0,
                feedback: 0.45,
                tone_hz: 2_000.0,
                mix: 0.3,
            };
            v.reverb = reverb(0.95, 0.5, 40.0, 0.6);
        }),
        builtin("lofi", "cassette-tape", |v| {
            v.character = character(CharacterMode::Bitcrusher, 0.55, 0.35);
        }),
    ]
}

impl Presets {
    pub fn load(&self, library: &Library) {
        let saved = library
            .setting(PRESETS_KEY)
            .and_then(|s| serde_json::from_str::<Vec<Preset>>(&s).ok());
        *self.list.lock() = saved.unwrap_or_else(builtins);
        *self.active.lock() = library.setting(ACTIVE_KEY).filter(|s| !s.is_empty());
    }

    fn save(&self, library: &Library) {
        if let Ok(json) = serde_json::to_string(&*self.list.lock()) {
            let _ = library.set_setting(PRESETS_KEY, &json);
        }
        let active = self.active.lock().clone().unwrap_or_default();
        let _ = library.set_setting(ACTIVE_KEY, &active);
    }

    pub fn list(&self) -> Vec<Preset> {
        self.list.lock().clone()
    }

    fn state(&self) -> PresetState {
        PresetState {
            presets: self.list(),
            active: self.active.lock().clone(),
        }
    }
}

/// Setzt die Stimm-Effekte, merkt das aktive Preset und meldet es der Oberfläche.
fn set_voice<R: Runtime>(app: &AppHandle<R>, voice: VoiceParams, active: Option<String>) {
    let effects = app.state::<Engine>().mixer.effects.set_voice(voice);
    app.state::<MixerDirty>().0.store(true, Ordering::Relaxed);
    let presets = app.state::<Presets>();
    *presets.active.lock() = active.clone();
    presets.save(&app.state::<Library>());
    let _ = app.emit("effects://changed", VoiceChanged { effects, active });
}

fn apply<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    let preset = app
        .state::<Presets>()
        .list
        .lock()
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| crate::tr!("Preset nicht gefunden", "Preset not found"))?;
    let mut voice = preset.voice;
    voice.enabled = true;
    set_voice(app, voice, Some(preset.id));
    Ok(())
}

/// Hotkey eines Presets: einschalten oder, wenn es schon aktiv ist, aus.
pub fn toggle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let active = app.state::<Presets>().active.lock().clone();
    if active.as_deref() == Some(id) {
        let mut voice = app.state::<Engine>().mixer.effects.params().voice;
        voice.enabled = false;
        set_voice(app, voice, None);
    } else {
        let _ = apply(app, id);
    }
}

/// Hotkeys aller Presets: (Name, Hotkey, ID).
pub fn hotkeys<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String, String)> {
    app.state::<Presets>()
        .list
        .lock()
        .iter()
        .filter_map(|p| {
            p.hotkey
                .as_ref()
                .map(|h| (display_name(p), h.clone(), p.id.clone()))
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    state: PresetState,
    hotkey_errors: Vec<String>,
}

#[tauri::command]
pub fn presets_state(presets: State<Presets>) -> PresetState {
    presets.state()
}

#[tauri::command]
pub fn preset_apply(app: AppHandle, id: String) -> Result<(), String> {
    apply(&app, &id)
}

/// Schaltet die Stimm-Effekte aus, ohne ihre Einstellungen zu verlieren.
#[tauri::command]
pub fn preset_off(app: AppHandle) {
    let mut voice = app.state::<Engine>().mixer.effects.params().voice;
    voice.enabled = false;
    set_voice(&app, voice, None);
}

/// Legt ein Preset an oder ersetzt eines mit derselben ID.
#[tauri::command]
pub fn preset_save(app: AppHandle, preset: Preset) -> SaveResult {
    let presets = app.state::<Presets>();
    let hotkey_changed = {
        let mut list = presets.list.lock();
        match list.iter_mut().find(|p| p.id == preset.id) {
            Some(existing) => {
                let changed = existing.hotkey != preset.hotkey;
                let builtin = existing.builtin;
                *existing = Preset { builtin, ..preset };
                changed
            }
            None => {
                let changed = preset.hotkey.is_some();
                list.push(Preset {
                    builtin: false,
                    ..preset
                });
                changed
            }
        }
    };
    presets.save(&app.state::<Library>());
    let hotkey_errors = if hotkey_changed {
        crate::soundboard::sync_hotkeys(&app)
    } else {
        Vec::new()
    };
    SaveResult {
        state: presets.state(),
        hotkey_errors,
    }
}

#[tauri::command]
pub fn preset_delete(app: AppHandle, id: String) -> PresetState {
    let presets = app.state::<Presets>();
    presets.list.lock().retain(|p| p.id != id);
    {
        let mut active = presets.active.lock();
        if active.as_deref() == Some(id.as_str()) {
            *active = None;
        }
    }
    presets.save(&app.state::<Library>());
    crate::soundboard::sync_hotkeys(&app);
    presets.state()
}

/// Stellt die Reihenfolge ein, z. B. nach Ziehen in der Oberfläche.
#[tauri::command]
pub fn presets_reorder(app: AppHandle, ids: Vec<String>) -> PresetState {
    let presets = app.state::<Presets>();
    {
        let mut list = presets.list.lock();
        list.sort_by_key(|p| ids.iter().position(|id| *id == p.id).unwrap_or(usize::MAX));
    }
    presets.save(&app.state::<Library>());
    presets.state()
}

/// Fügt fehlende mitgelieferte Presets wieder hinzu und setzt geänderte zurück.
#[tauri::command]
pub fn presets_restore(app: AppHandle) -> PresetState {
    let presets = app.state::<Presets>();
    {
        let mut list = presets.list.lock();
        for preset in builtins() {
            match list.iter_mut().find(|p| p.id == preset.id) {
                Some(existing) => {
                    let hotkey = existing.hotkey.take();
                    *existing = Preset { hotkey, ..preset };
                }
                None => list.push(preset),
            }
        }
    }
    presets.save(&app.state::<Library>());
    presets.state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_have_names_and_unique_ids() {
        let list = builtins();
        for p in &list {
            assert!(builtin_name(&p.id).is_some(), "{}", p.id);
            assert!(p.voice.enabled);
            assert_eq!(p.voice, p.voice.clamped(), "{}", p.id);
        }
        let mut ids: Vec<_> = list.iter().map(|p| p.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), list.len());
    }

    #[test]
    fn presets_round_trip_as_json() {
        let json = serde_json::to_string(&builtins()).unwrap();
        let back: Vec<Preset> = serde_json::from_str(&json).unwrap();
        assert_eq!(back.len(), builtins().len());
        assert_eq!(back[0].voice, builtins()[0].voice);
    }
}
