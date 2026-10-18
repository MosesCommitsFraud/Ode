pub mod audio;
pub mod library;
mod soundboard;

use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use audio::ENGINE_RATE;
use audio::devices::{self, DeviceList};
use audio::engine::{Engine, EngineConfig, EngineInfo};
use audio::mixer::{ChannelId, ChannelParams, Mixer, Output, OutputId, OutputParams};
use audio::sampler::PlayingSound;
use library::Library;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MixerState {
    channels: Vec<(ChannelId, ChannelParams)>,
    out_a: OutputParams,
    out_b: OutputParams,
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
    let latency_ms = if running {
        input_callback_ms + out_b.buffered_ms + out_b.callback_ms
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
        playing: engine.playing.lock().clone(),
    }
}

fn spawn_meter_loop(app: AppHandle) {
    thread::Builder::new()
        .name("ode-meters".into())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(33));
                let meters = snapshot(&app.state::<Engine>());
                let _ = app.emit("engine://meters", meters);
            }
        })
        .expect("Pegel-Thread konnte nicht starten");
}

#[tauri::command]
fn list_devices() -> Result<DeviceList, String> {
    devices::list(&cpal::default_host()).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_engine(engine: State<Engine>, config: EngineConfig) -> Result<EngineInfo, String> {
    engine.start(config)
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
fn get_mixer(engine: State<Engine>) -> MixerState {
    let mixer = &engine.mixer;
    MixerState {
        channels: ChannelId::ALL
            .iter()
            .map(|&id| (id, mixer.channel(id).params()))
            .collect(),
        out_a: mixer.out_a.params(),
        out_b: mixer.out_b.params(),
    }
}

#[tauri::command]
fn set_channel(engine: State<Engine>, channel: ChannelId, params: ChannelParams) {
    engine.mixer.channel(channel).set(params);
}

#[tauri::command]
fn set_output(engine: State<Engine>, output: OutputId, params: OutputParams) {
    engine.mixer.output(output).set(params);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(soundboard::hotkey_plugin())
        .manage(Engine::spawn())
        .manage(soundboard::Hotkeys::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(Library::open(&data_dir)?);
            soundboard::sync_hotkeys(app.handle());
            let handle = app.handle().clone();
            thread::spawn(move || handle.state::<Library>().preload());
            spawn_meter_loop(app.handle().clone());
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
            soundboard::library_list,
            soundboard::library_import,
            soundboard::library_update,
            soundboard::library_delete,
            soundboard::hotkey_errors,
            soundboard::sound_play,
            soundboard::sound_stop,
            soundboard::sound_stop_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
