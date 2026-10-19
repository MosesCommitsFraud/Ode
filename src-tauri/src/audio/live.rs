//! Live-Quellen: den Ton eines einzelnen Programms (Spotify, Browser, …)
//! mitschneiden und auf den eigenen Live-Kanal im Mischpult legen. Technisch über Windows'
//! Prozess-Loopback (ab Windows 10 2004): Ode bekommt nur den Ton dieses
//! Programms samt seiner Unterprozesse, unabhängig vom Ausgabegerät.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

use crossbeam_channel::{Sender, bounded};
use parking_lot::Mutex;
use ringbuf::HeapProd;
use ringbuf::traits::Producer;
use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, ActivateAudioInterfaceAsync, AudioSessionStateActive,
    DEVICE_STATE_ACTIVE, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IAudioSessionControl2, IAudioSessionManager2,
    IMMDeviceEnumerator, MMDeviceEnumerator, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    BLOB, CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW, WaitForSingleObject,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::core::{Interface, PWSTR, Ref, implement};

use super::ENGINE_RATE;

/// Ein Programm, das gerade Ton ausgibt (oder eine Audio-Sitzung hat).
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSource {
    pub pid: u32,
    /// Anzeigename, z. B. „Spotify“.
    pub name: String,
    /// Programmdatei, z. B. „Spotify.exe“.
    pub exe: String,
    /// Spielt gerade hörbar etwas ab.
    pub playing: bool,
    /// Programm-Icon als PNG-Data-URL, falls vorhanden.
    #[serde(default)]
    pub icon: Option<String>,
}

/// Bekannte Programme schöner benennen.
fn pretty_name(exe: &str) -> String {
    let stem = exe.trim_end_matches(".exe").trim_end_matches(".EXE");
    match stem.to_lowercase().as_str() {
        "chrome" => "Chrome".into(),
        "msedge" => "Edge".into(),
        "firefox" => "Firefox".into(),
        "opera" | "opera_gx" => "Opera".into(),
        "brave" => "Brave".into(),
        "spotify" => "Spotify".into(),
        "discord" => "Discord".into(),
        "vlc" => "VLC".into(),
        "applemusic" | "itunes" => "Apple Music".into(),
        _ => {
            let mut chars = stem.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        }
    }
}

/// Voller Pfad der Programmdatei eines Prozesses.
fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Programme mit Audio-Sitzung auf irgendeinem Ausgabegerät, ohne Ode selbst.
pub fn list_sources() -> anyhow::Result<Vec<AppSource>> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let own = std::process::id();
        let mut sources: Vec<AppSource> = Vec::new();
        for i in 0..devices.GetCount()? {
            let Ok(device) = devices.Item(i) else {
                continue;
            };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                continue;
            };
            let Ok(sessions) = manager.GetSessionEnumerator() else {
                continue;
            };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(session) = sessions.GetSession(j) else {
                    continue;
                };
                let Ok(control) = session.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = control.GetProcessId() else {
                    continue;
                };
                if pid == 0 || pid == own {
                    continue;
                }
                let playing = control
                    .GetState()
                    .is_ok_and(|s| s == AudioSessionStateActive);
                if let Some(existing) = sources.iter_mut().find(|s| s.pid == pid) {
                    existing.playing |= playing;
                    continue;
                }
                let Some(path) = exe_path(pid) else { continue };
                let exe = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
                sources.push(AppSource {
                    pid,
                    name: pretty_name(&exe),
                    exe,
                    playing,
                    icon: super::app_icon::icon_data_url(&path),
                });
            }
        }
        // Gleiches Programm mehrfach (z. B. Browser-Prozesse): einmal zeigen.
        sources.sort_by(|a, b| b.playing.cmp(&a.playing).then(a.name.cmp(&b.name)));
        let mut seen = Vec::new();
        sources.retain(|s| {
            let key = s.exe.to_lowercase();
            if seen.contains(&key) {
                false
            } else {
                seen.push(key);
                true
            }
        });
        Ok(sources)
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Activated(Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

/// Öffnet den Prozess-Loopback für `pid` (48 kHz, Stereo, f32).
unsafe fn open_loopback(pid: u32) -> anyhow::Result<(IAudioClient, IAudioCaptureClient, HANDLE)> {
    unsafe {
        let params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        // Nie automatisch freigeben: PROPVARIANT ruft beim Drop PropVariantClear auf
        // und würde den Blob (unsere Struktur auf dem Stack) freigeben.
        let mut prop = std::mem::ManuallyDrop::new(PROPVARIANT::default());
        {
            let inner = &mut *prop.Anonymous.Anonymous;
            inner.vt = VT_BLOB;
            inner.Anonymous.blob = BLOB {
                cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                pBlobData: &params as *const _ as *mut u8,
            };
        }

        let (tx, rx) = bounded(1);
        let handler: IActivateAudioInterfaceCompletionHandler = Activated(tx).into();
        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*prop),
            &handler,
        )?;
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| {
                anyhow::anyhow!(crate::tr!(
                    "Windows hat den Mitschnitt nicht freigegeben",
                    "Windows did not allow capturing this app"
                ))
            })?;
        let mut result = windows::core::HRESULT(0);
        let mut unknown = None;
        operation.GetActivateResult(&mut result, &mut unknown)?;
        result.ok()?;
        let client: IAudioClient = unknown
            .ok_or_else(|| anyhow::anyhow!(crate::tr!("Kein Audio-Client", "No audio client")))?
            .cast()?;

        let format = WAVEFORMATEX {
            wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
            nChannels: 2,
            nSamplesPerSec: ENGINE_RATE,
            nAvgBytesPerSec: ENGINE_RATE * 8,
            nBlockAlign: 8,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            200_000, // 20 ms in 100-ns-Einheiten
            0,
            &format,
            None,
        )?;
        let event = CreateEventW(None, false, false, None)?;
        client.SetEventHandle(event)?;
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        Ok((client, capture, event))
    }
}

/// Liest den Mitschnitt, mischt auf Mono und verteilt auf die Ausgänge.
fn capture_loop(
    pid: u32,
    stop: Arc<AtomicBool>,
    producers: Arc<Mutex<Vec<HeapProd<f32>>>>,
    started: Sender<Result<(), String>>,
) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let (client, capture, event) = match open_loopback(pid) {
            Ok(opened) => {
                let _ = started.send(Ok(()));
                opened
            }
            Err(e) => {
                let _ = started.send(Err(e.to_string()));
                CoUninitialize();
                return;
            }
        };
        let mut mono: Vec<f32> = Vec::with_capacity(16_384);
        while !stop.load(Ordering::Relaxed) {
            if WaitForSingleObject(event, 100) != WAIT_OBJECT_0 {
                continue;
            }
            while capture.GetNextPacketSize().unwrap_or(0) > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                if capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }
                mono.clear();
                if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                    mono.resize(frames as usize, 0.0);
                } else {
                    let samples =
                        std::slice::from_raw_parts(data as *const f32, frames as usize * 2);
                    mono.extend(
                        samples
                            .as_chunks::<2>()
                            .0
                            .iter()
                            .map(|f| (f[0] + f[1]) * 0.5),
                    );
                }
                let _ = capture.ReleaseBuffer(frames);
                for producer in producers.lock().iter_mut() {
                    producer.push_slice(&mono);
                }
            }
        }
        let _ = client.Stop();
        let _ = CloseHandle(event);
        CoUninitialize();
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub source: Option<AppSource>,
    pub error: Option<String>,
}

struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Steuert die laufende Live-Quelle. Die Ringpuffer zu den Ausgängen setzt die
/// Engine bei jedem Start neu ein.
pub struct Live {
    producers: Arc<Mutex<Vec<HeapProd<f32>>>>,
    running: Mutex<Option<Running>>,
    status: Mutex<LiveStatus>,
}

impl Live {
    pub fn new(producers: Arc<Mutex<Vec<HeapProd<f32>>>>) -> Self {
        Self {
            producers,
            running: Mutex::new(None),
            status: Mutex::new(LiveStatus::default()),
        }
    }

    pub fn status(&self) -> LiveStatus {
        self.status.lock().clone()
    }

    pub fn start(&self, source: AppSource) -> Result<(), String> {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = bounded(1);
        let thread = {
            let stop = stop.clone();
            let producers = self.producers.clone();
            let pid = source.pid;
            thread::Builder::new()
                .name("ode-live".into())
                .spawn(move || capture_loop(pid, stop, producers, tx))
                .map_err(|e| e.to_string())?
        };
        let result = rx
            .recv_timeout(std::time::Duration::from_secs(8))
            .unwrap_or_else(|_| {
                Err(crate::tr!(
                    "Keine Antwort von Windows",
                    "No response from Windows"
                ))
            });
        let running = Running {
            stop,
            thread: Some(thread),
        };
        match result {
            Ok(()) => {
                *self.running.lock() = Some(running);
                *self.status.lock() = LiveStatus {
                    source: Some(source),
                    error: None,
                };
                Ok(())
            }
            Err(e) => {
                drop(running);
                let message = format!("{}: {e}", source.name);
                *self.status.lock() = LiveStatus {
                    source: None,
                    error: Some(message.clone()),
                };
                Err(message)
            }
        }
    }

    pub fn stop(&self) {
        let running = self.running.lock().take();
        drop(running);
        self.status.lock().source = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_names() {
        assert_eq!(pretty_name("Spotify.exe"), "Spotify");
        assert_eq!(pretty_name("msedge.exe"), "Edge");
        assert_eq!(pretty_name("foobar2000.exe"), "Foobar2000");
    }
}
