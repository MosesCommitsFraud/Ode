pub mod audio;
mod cable;
pub mod covers;
pub mod downloader;
pub mod i18n;
pub mod library;
pub mod music;
mod presets;
mod shell;
mod soundboard;

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use audio::ENGINE_RATE;
use audio::devices::{self, DeviceList};
use audio::effects::EffectsParams;
use audio::engine::{Engine, EngineConfig, EngineInfo};
use audio::mixer::{
    ChannelId, ChannelParams, DuckingParams, Mixer, MixerSettings, Output, OutputId, OutputParams,
};
use audio::sampler::PlayingSound;
use downloader::{Downloads, Tools};
use library::Library;
use music::{MusicLibrary, Player};

const MIXER_KEY: &str = "mixer";

/// Merkt sich, dass das Mischpult gespeichert werden muss.
#[derive(Default)]
pub(crate) struct MixerDirty(pub(crate) AtomicBool);

fn load_mixer(app: &AppHandle) {
    let saved = app.state::<Library>().setting(MIXER_KEY);
    if let Some(settings) = saved.and_then(|s| serde_json::from_str::<MixerSettings>(&s).ok()) {
        app.state::<Engine>().mixer.apply(&settings);
    }
}

/// Speichert gesammelt höchstens alle 500 ms, damit Fader-Ziehen nicht ständig schreibt.
fn spawn_mixer_saver(app: AppHandle) {
    thread::Builder::new()
        .name("ode-settings".into())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(500));
                if app.state::<MixerDirty>().0.swap(false, Ordering::Relaxed) {
                    let settings = app.state::<Engine>().mixer.settings();
                    if let Ok(json) = serde_json::to_string(&settings) {
                        let _ = app.state::<Library>().set_setting(MIXER_KEY, &json);
                    }
                }
            }
        })
        .expect("Einstellungs-Thread konnte nicht starten");
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputMeters {
    peak: f32,
    gain_reduction_db: f32,
    buffered_ms: f32,
    callback_ms: f32,
    underruns: u64,
    overruns: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChannelMeter {
    id: ChannelId,
    peak: f32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Meters {
    running: bool,
    channels: Vec<ChannelMeter>,
    out_a: OutputMeters,
    out_b: OutputMeters,
    input_callback_ms: f32,
    /// Geschätzte Verzögerung Mikrofon → Kabel innerhalb der App.
    latency_ms: f32,
    errors: Vec<String>,
    playing: Vec<PlayingSound>,
    /// Aktuelle Absenkung durch Ducking in dB (0 = keine).
    ducking_db: f32,
    effects: EffectMeters,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EffectMeters {
    gate_open: bool,
    voice: f32,
    voice_open: bool,
    agc_gain_db: f32,
    compressor_db: f32,
    de_esser_db: f32,
    limiter_db: f32,
    /// Erkannte Tonhöhe in Hz, 0 = keine.
    pitch_hz: f32,
    /// Zielnote des Autotune (Midi), −1 = keine.
    target_note: f32,
    correction_cents: f32,
    /// Zusätzliche Verzögerung der Stimm-Effekte.
    voice_latency_ms: f32,
    vocoder: Vec<f32>,
}

fn frames_to_ms(frames: u32, rate: u32) -> f32 {
    if rate == 0 {
        0.0
    } else {
        frames as f32 * 1000.0 / rate as f32
    }
}

fn output_meters(output: &Output) -> OutputMeters {
    OutputMeters {
        peak: output.meter.take(),
        gain_reduction_db: output.gain_reduction_db.load(),
        buffered_ms: frames_to_ms(output.buffered_frames.load(Ordering::Relaxed), ENGINE_RATE),
        callback_ms: frames_to_ms(
            output.callback_frames.load(Ordering::Relaxed),
            output.device_rate.load(Ordering::Relaxed),
        ),
        underruns: output.underruns.load(Ordering::Relaxed),
        overruns: output.overruns.load(Ordering::Relaxed),
    }
}

fn snapshot(engine: &Engine) -> Meters {
    let mixer: &Mixer = &engine.mixer;
    let running = engine.info().is_some();
    let input_callback_ms = frames_to_ms(
        mixer.input_callback_frames.load(Ordering::Relaxed),
        mixer.input_rate.load(Ordering::Relaxed),
    );
    let channels = ChannelId::ALL
        .iter()
        .map(|&id| ChannelMeter {
            id,
            peak: mixer.channel(id).meter.take(),
        })
        .collect();
    let out_a = output_meters(&mixer.out_a);
    let out_b = output_meters(&mixer.out_b);
    let voice = &mixer.effects.voice_fx;
    let latency_ms = if running {
        input_callback_ms + out_b.buffered_ms + out_b.callback_ms + voice.latency_ms.load()
    } else {
        0.0
    };
    Meters {
        running,
        channels,
        out_a,
        out_b,
        input_callback_ms,
        latency_ms,
        errors: engine.errors.lock().clone(),
        playing: engine
            .playing
            .lock()
            .iter()
            .chain(engine.preview_playing.lock().iter())
            .cloned()
            .collect(),
        effects: EffectMeters {
            gate_open: mixer.effects.gate_open.load(Ordering::Relaxed),
            voice: mixer.effects.voice.load(),
            voice_open: mixer.effects.voice_open.load(Ordering::Relaxed),
            agc_gain_db: mixer.effects.agc_gain_db.load(),
            compressor_db: mixer.effects.compressor_reduction_db.load(),
            de_esser_db: mixer.effects.de_esser_reduction_db.load(),
            limiter_db: mixer.effects.limiter_reduction_db.load(),
            pitch_hz: voice.pitch_hz.load(),
            target_note: voice.target_note.load(),
            correction_cents: voice.correction_cents.load(),
            voice_latency_ms: voice.latency_ms.load(),
            vocoder: voice.vocoder.iter().map(|b| b.take()).collect(),
        },
        ducking_db: if running {
            mixer.ducking.reduction_db.load()
        } else {
            0.0
        },
    }
}

fn spawn_meter_loop(app: AppHandle) {
    thread::Builder::new()
        .name("ode-meters".into())
        .spawn(move || {
            let mut tick = 0u32;
            loop {
                thread::sleep(Duration::from_millis(33));
                let meters = snapshot(&app.state::<Engine>());
                let _ = app.emit("engine://meters", meters);
                // Player-Stand reicht mit etwa 10 Hz.
                tick = tick.wrapping_add(1);
                if tick.is_multiple_of(3) {
                    let player = app.state::<Player>().snapshot(&app);
                    let _ = app.emit("player://state", player);
                }
            }
        })
        .expect("Pegel-Thread konnte nicht starten");
}

#[tauri::command]
fn list_devices() -> Result<DeviceList, String> {
    devices::list(&cpal::default_host()).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_engine(
    app: AppHandle,
    engine: State<Engine>,
    config: EngineConfig,
) -> Result<EngineInfo, String> {
    let info = engine.start(config)?;
    // Neue Streams haben leere Decks: laufenden Titel wieder laden.
    app.state::<Player>().resync(&app);
    Ok(info)
}

#[tauri::command]
fn stop_engine(engine: State<Engine>) {
    engine.stop();
}

#[tauri::command]
fn engine_info(engine: State<Engine>) -> Option<EngineInfo> {
    engine.info()
}

#[tauri::command]
fn get_mixer(engine: State<Engine>) -> MixerSettings {
    engine.mixer.settings()
}

#[tauri::command]
fn set_channel(
    engine: State<Engine>,
    dirty: State<MixerDirty>,
    channel: ChannelId,
    params: ChannelParams,
) {
    engine.mixer.channel(channel).set(params);
    dirty.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn set_output(
    engine: State<Engine>,
    dirty: State<MixerDirty>,
    output: OutputId,
    params: OutputParams,
) {
    engine.mixer.output(output).set(params);
    dirty.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn set_ducking(engine: State<Engine>, dirty: State<MixerDirty>, params: DuckingParams) {
    engine.mixer.ducking.set(params);
    dirty.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn set_effects(engine: State<Engine>, dirty: State<MixerDirty>, params: EffectsParams) {
    engine.mixer.effects.set(params);
    dirty.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn set_player_volume(engine: State<Engine>, dirty: State<MixerDirty>, volume: f32) {
    engine.mixer.player_volume.store(volume.clamp(0.0, 1.0));
    dirty.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn live_sources() -> Result<Vec<audio::live::AppSource>, String> {
    audio::live::list_sources().map_err(|e| e.to_string())
}

#[tauri::command]
async fn live_start(
    live: State<'_, audio::live::Live>,
    source: audio::live::AppSource,
) -> Result<audio::live::LiveStatus, String> {
    live.start(source)?;
    Ok(live.status())
}

#[tauri::command]
fn live_stop(live: State<audio::live::Live>) -> audio::live::LiveStatus {
    live.stop();
    live.status()
}

#[tauri::command]
fn live_status(live: State<audio::live::Live>) -> audio::live::LiveStatus {
    live.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = Engine::spawn();
    let live = audio::live::Live::new(engine.live_producers.clone());
    tauri::Builder::default()
        // Ein zweiter Start holt nur das laufende Fenster nach vorn.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![shell::MINIMIZED_ARG]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(soundboard::hotkey_plugin())
        .manage(engine)
        .manage(live)
        .manage(soundboard::Hotkeys::default())
        .manage(MixerDirty::default())
        .manage(presets::Presets::default())
        .manage(Player::default())
        .on_window_event(shell::on_window_event)
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(Library::open(&data_dir)?);
            app.manage(MusicLibrary::open(&data_dir)?);
            app.manage(Tools::new(&data_dir)?);
            app.manage(cable::Cable::new(&data_dir));
            app.manage(Downloads::new(&data_dir)?);
            downloader::start(app.handle());
            Player::spawn_monitor(app.handle().clone());
            load_mixer(app.handle());
            app.state::<presets::Presets>()
                .load(&app.state::<Library>());
            spawn_mixer_saver(app.handle().clone());
            soundboard::sync_hotkeys(app.handle());
            let handle = app.handle().clone();
            thread::spawn(move || handle.state::<Library>().preload());
            spawn_meter_loop(app.handle().clone());
            shell::create_tray(app.handle())?;
            shell::show_on_start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            start_engine,
            stop_engine,
            engine_info,
            get_mixer,
            set_channel,
            set_output,
            set_ducking,
            set_effects,
            set_player_volume,
            live_sources,
            live_start,
            live_stop,
            live_status,
            soundboard::library_list,
            soundboard::library_import,
            soundboard::library_update,
            soundboard::library_delete,
            soundboard::hotkey_errors,
            soundboard::sound_play,
            soundboard::sound_preview,
            soundboard::sound_stop,
            soundboard::sound_stop_all,
            music::music_state,
            music::music_import,
            music::music_delete_track,
            music::playlist_create,
            music::playlist_rename,
            music::playlist_delete,
            music::playlist_set_tracks,
            music::player_play,
            music::player_toggle,
            music::player_next,
            music::player_previous,
            music::player_seek,
            music::player_set_shuffle,
            music::player_set_repeat,
            downloader::tools_status,
            downloader::tools_install,
            downloader::downloads_list,
            downloader::download_add,
            downloader::download_cancel,
            downloader::downloads_clear,
            downloader::download_set_target,
            shell::app_settings,
            shell::set_app_settings,
            shell::quit_app,
            cable::cable_status,
            cable::cable_install,
            cable::open_sound_settings,
            presets::presets_state,
            presets::preset_apply,
            presets::preset_off,
            presets::preset_save,
            presets::preset_delete,
            presets::presets_reorder,
            presets::presets_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
