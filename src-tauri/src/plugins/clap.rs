//! CLAP-Host im Plugin-Hilfsprozess. Alle Aufrufe, die CLAP dem
//! „Main-Thread“ vorbehält (Laden, Aktivieren, Parameter lesen, Fenster),
//! laufen auf dessen Haupt-Thread mit Win32-Nachrichtenschleife; Ode schickt
//! ihm Anfragen (siehe `child`). Das Audio rechnet ein Slot im Audio-Thread
//! des Hilfsprozesses (siehe `shm`), die Verarbeitung startet dort.

use std::any::Any;
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use std::time::Duration;

use clack_extensions::audio_ports::{AudioPortInfoBuffer, PluginAudioPorts};
use clack_extensions::gui::{GuiApiType, GuiConfiguration, GuiSize, PluginGui, Window};
use clack_extensions::latency::PluginLatency;
use clack_extensions::params::{ParamInfoBuffer, ParamInfoFlags, PluginParams};
use clack_host::events::event_types::ParamValueEvent;
use clack_host::prelude::*;
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, bounded};

use super::{ParamDesc, PluginInfo, PluginStatus, Request, test_plugin};
use crate::audio::ENGINE_RATE;
use crate::audio::insert::{Insert, InsertSlot};

/// Größter Block, den das Plugin auf einmal bekommt; längere werden geteilt.
const MAX_BLOCK: usize = 1024;

// ------------------------------------------------------------ Host-Seite

pub struct OdeHost;

pub struct OdeShared {
    /// Das Plugin möchte auf dem Main-Thread zurückgerufen werden.
    callback: AtomicBool,
}

impl<'a> SharedHandler<'a> for OdeShared {
    fn request_restart(&self) {}
    fn request_process(&self) {}
    fn request_callback(&self) {
        self.callback.store(true, Ordering::Release);
    }
}

impl HostHandlers for OdeHost {
    type Shared<'a> = OdeShared;
    type MainThread<'a> = ();
    type AudioProcessor<'a> = ();
}

fn host_info() -> HostInfo {
    HostInfo::new(
        "Ode",
        "Ode",
        "https://github.com/MosesCommitsFraud/Ode",
        env!("CARGO_PKG_VERSION"),
    )
    .expect("Host-Info ist gültig")
}

fn text(s: Option<&CStr>) -> String {
    s.map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn bytes_text(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

fn err(e: impl std::fmt::Debug) -> String {
    format!("{e:?}")
}

/// Plugins einer geladenen Bibliothek.
fn descriptors(entry: &PluginEntry, path: &Path) -> Vec<PluginInfo> {
    let Some(factory) = entry.get_plugin_factory() else {
        return Vec::new();
    };
    factory
        .plugin_descriptors()
        .filter_map(|d| {
            Some(PluginInfo {
                path: path.to_string_lossy().into_owned(),
                id: text(Some(d.id()?)),
                name: text(d.name()),
                vendor: text(d.vendor()),
                version: text(d.version()),
            })
        })
        .collect()
}

/// Standard-Ordner für CLAP unter Windows, plus `CLAP_PATH`.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(paths) = std::env::var("CLAP_PATH") {
        dirs.extend(std::env::split_paths(&paths));
    }
    if let Ok(common) = std::env::var("COMMONPROGRAMFILES") {
        dirs.push(Path::new(&common).join("CLAP"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(
            Path::new(&local)
                .join("Programs")
                .join("Common")
                .join("CLAP"),
        );
    }
    dirs
}

fn find_clap_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() && depth < 6 {
            find_clap_files(&path, out, depth + 1);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("clap"))
        {
            out.push(path);
        }
    }
}

// ------------------------------------------------------------ Audio

/// Das Plugin im Plugin-Slot: Mono rein, je nach Plugin Mono oder Stereo
/// verarbeitet, Mono wieder raus.
struct ClapInsert {
    processor: PluginAudioProcessor<OdeHost>,
    in_ports: AudioPorts,
    out_ports: AudioPorts,
    inputs: Vec<Vec<f32>>,
    outputs: Vec<Vec<f32>>,
    events: EventBuffer,
    out_events: EventBuffer,
    params: Receiver<(u32, f64)>,
    steady: u64,
    /// Start oder Verarbeitung schlug fehl: ab dann trocken durchlassen.
    failed: bool,
}

impl ClapInsert {
    fn new(
        processor: StoppedPluginAudioProcessor<OdeHost>,
        channels: (usize, usize),
        params: Receiver<(u32, f64)>,
    ) -> Self {
        Self {
            processor: processor.into(),
            in_ports: AudioPorts::with_capacity(channels.0, 1),
            out_ports: AudioPorts::with_capacity(channels.1, 1),
            inputs: vec![vec![0.0; MAX_BLOCK]; channels.0],
            outputs: vec![vec![0.0; MAX_BLOCK]; channels.1],
            events: EventBuffer::with_capacity(512),
            out_events: EventBuffer::with_capacity(512),
            params,
            steady: 0,
            failed: false,
        }
    }
}

impl Insert for ClapInsert {
    fn process(&mut self, buf: &mut [f32]) {
        if self.failed {
            return;
        }
        // CLAP: Verarbeitung im Audio-Thread starten.
        let Ok(started) = self.processor.ensure_processing_started() else {
            self.failed = true;
            return;
        };
        for chunk in buf.chunks_mut(MAX_BLOCK) {
            let n = chunk.len();
            for channel in &mut self.inputs {
                channel[..n].copy_from_slice(chunk);
            }
            self.events.clear();
            while let Ok((id, value)) = self.params.try_recv() {
                self.events.push(&ParamValueEvent::new(
                    0,
                    ClapId::new(id),
                    Pckn::match_all(),
                    value,
                ));
            }
            self.out_events.clear();

            let input = self.in_ports.with_input_buffers([AudioPortBuffer {
                latency: 0,
                channels: AudioPortBufferType::f32_input_only(
                    self.inputs
                        .iter_mut()
                        .map(|b| InputChannel::variable(&mut b[..n])),
                ),
            }]);
            let mut output = self.out_ports.with_output_buffers([AudioPortBuffer {
                latency: 0,
                channels: AudioPortBufferType::f32_output_only(
                    self.outputs.iter_mut().map(|b| &mut b[..n]),
                ),
            }]);
            let result = started.process(
                &input,
                &mut output,
                &InputEvents::from_buffer(&self.events),
                &mut OutputEvents::from_buffer(&mut self.out_events),
                Some(self.steady),
                None,
            );
            self.steady += n as u64;
            if result.is_err() {
                self.failed = true;
                return;
            }
            // Auf Mono zurück: Mittel der Ausgangskanäle.
            let scale = 1.0 / self.outputs.len().max(1) as f32;
            for (i, s) in chunk.iter_mut().enumerate() {
                *s = self.outputs.iter().map(|c| c[i]).sum::<f32>() * scale;
            }
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any + Send> {
        self
    }
}

// ------------------------------------------------------------ Fenster

#[cfg(windows)]
mod window {
    //! Ein schlichtes Win32-Fenster, in das sich die Plugin-Oberfläche einbettet.

    use std::cell::Cell;

    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        AdjustWindowRectEx, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, CreateWindowExW, DefWindowProcW,
        DestroyWindow, DispatchMessageW, MSG, PM_REMOVE, PeekMessageW, RegisterClassW, SW_SHOW,
        ShowWindow, TranslateMessage, WINDOW_EX_STYLE, WM_CLOSE, WNDCLASSW, WS_CAPTION,
        WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU,
    };
    use windows::core::{PCWSTR, w};

    thread_local! {
        static CLOSE_REQUESTED: Cell<bool> = const { Cell::new(false) };
    }

    const CLASS: PCWSTR = w!("OdePluginWindow");

    unsafe extern "system" fn proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_CLOSE {
            // Erst das Plugin abbauen, dann das Fenster: das macht die Schleife.
            CLOSE_REQUESTED.with(|c| c.set(true));
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    pub struct HostWindow {
        pub hwnd: HWND,
    }

    impl HostWindow {
        pub fn open(title: &str, width: u32, height: u32) -> Result<Self, String> {
            unsafe {
                let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
                let class = WNDCLASSW {
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(proc),
                    hInstance: instance.into(),
                    lpszClassName: CLASS,
                    ..Default::default()
                };
                // Mehrfaches Anmelden schlägt harmlos fehl.
                RegisterClassW(&class);
                let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
                let mut rect = RECT {
                    left: 0,
                    top: 0,
                    right: width as i32,
                    bottom: height as i32,
                };
                let _ = AdjustWindowRectEx(&mut rect, style, false, WINDOW_EX_STYLE::default());
                let title: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();
                let hwnd = CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    CLASS,
                    PCWSTR(title.as_ptr()),
                    style,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    None,
                    None,
                    Some(instance.into()),
                    None,
                )
                .map_err(|e| e.to_string())?;
                Ok(Self { hwnd })
            }
        }

        pub fn show(&self) {
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_SHOW);
            }
        }
    }

    impl Drop for HostWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
        }
    }

    /// Arbeitet alle wartenden Fenster-Nachrichten dieses Threads ab und
    /// meldet, ob der Nutzer das Fenster schließen wollte.
    pub fn pump() -> bool {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        CLOSE_REQUESTED.with(|c| c.replace(false))
    }
}

// ------------------------------------------------------------ Main-Thread des Hilfsprozesses

struct Loaded {
    info: PluginInfo,
    /// Wird vor der Bibliothek abgebaut (Feldreihenfolge).
    instance: PluginInstance<OdeHost>,
    params_tx: Sender<(u32, f64)>,
    /// Zuletzt gesetzte Werte, bis das Plugin sie selbst meldet.
    pending: Vec<(u32, f64)>,
    latency: u32,
    #[cfg(windows)]
    window: Option<window::HostWindow>,
    floating: bool,
    _entry: PluginEntry,
}

/// Besitzt das geladene Plugin. Läuft auf dem Main-Thread des
/// Hilfsprozesses; das Audio rechnet der Slot im Audio-Thread.
pub(crate) struct Worker {
    slot: Arc<InsertSlot>,
    loaded: Option<Loaded>,
}

impl Worker {
    pub(crate) fn new(slot: Arc<InsertSlot>) -> Self {
        Self { slot, loaded: None }
    }

    /// Arbeitet Anfragen ab, bis der Kanal schließt; jede bekommt genau eine
    /// Antwort über `reply`.
    pub(crate) fn run(
        mut self,
        requests: Receiver<Result<Request, String>>,
        mut reply: impl FnMut(Result<serde_json::Value, String>),
    ) {
        loop {
            // Mit offenem Plugin-Fenster öfter nach Nachrichten sehen.
            let wait = if self.window_open() { 8 } else { 30 };
            match requests.recv_timeout(Duration::from_millis(wait)) {
                Ok(request) => reply(request.and_then(|r| self.handle(r))),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            self.idle();
        }
        self.unload();
    }

    fn window_open(&self) -> bool {
        self.loaded.as_ref().is_some_and(|l| {
            #[cfg(windows)]
            {
                l.window.is_some() || l.floating
            }
            #[cfg(not(windows))]
            {
                l.floating
            }
        })
    }

    /// Fenster-Nachrichten und Rückrufwünsche des Plugins.
    fn idle(&mut self) {
        #[cfg(windows)]
        let close = window::pump();
        #[cfg(not(windows))]
        let close = false;
        if close {
            self.close_gui();
        }
        if let Some(l) = &mut self.loaded {
            let wants = l
                .instance
                .access_shared_handler(|s| s.callback.swap(false, Ordering::AcqRel));
            if wants {
                l.instance.call_on_main_thread_callback();
            }
        }
    }

    pub(crate) fn handle(&mut self, request: Request) -> Result<serde_json::Value, String> {
        fn json(value: impl serde::Serialize) -> Result<serde_json::Value, String> {
            serde_json::to_value(value).map_err(|e| e.to_string())
        }
        match request {
            Request::Status => json(self.status()),
            Request::Scan => json(scan()),
            Request::Entries { path } => json(entries(Path::new(&path))?),
            Request::Load { path, id } => {
                self.load(&path, &id)?;
                json(self.status())
            }
            Request::Unload => {
                self.unload();
                json(self.status())
            }
            Request::Params => json(self.params()?),
            Request::SetParam { id, value } => {
                self.set_param(id, value);
                json(())
            }
            Request::Gui { open } => {
                if open {
                    self.open_gui()?;
                } else {
                    self.close_gui();
                }
                json(self.status())
            }
        }
    }

    fn set_param(&mut self, id: u32, value: f64) {
        if let Some(l) = &mut self.loaded {
            let _ = l.params_tx.try_send((id, value));
            l.pending.retain(|(p, _)| *p != id);
            l.pending.push((id, value));
        }
    }

    fn status(&mut self) -> PluginStatus {
        let load_ms = self.slot.load_ms.load();
        let window_open = self.window_open();
        let Some(l) = &mut self.loaded else {
            return PluginStatus {
                available: true,
                ..Default::default()
            };
        };
        let handle = l.instance.plugin_handle();
        let has_gui = handle.get_extension::<PluginGui>().is_some();
        PluginStatus {
            available: true,
            loaded: Some(l.info.clone()),
            has_gui,
            gui_open: window_open,
            latency_ms: l.latency as f32 * 1000.0 / ENGINE_RATE as f32,
            load_ms,
            ..Default::default()
        }
    }

    fn load(&mut self, path: &str, id: &str) -> Result<(), String> {
        self.unload();
        if path == test_plugin::PATH {
            let entry = test_plugin::entry()?;
            let info = descriptors(&entry, Path::new(path))
                .into_iter()
                .next()
                .ok_or("Test-Plugin fehlt")?;
            return self.load_entry(entry, info);
        }
        // SAFETY: Eine Plugin-Bibliothek führt beim Laden eigenen Code aus;
        // der Nutzer hat sie selbst ausgewählt.
        let entry = unsafe { PluginEntry::load(path) }.map_err(err)?;
        let info = descriptors(&entry, Path::new(path))
            .into_iter()
            .find(|d| d.id == id)
            .ok_or_else(|| crate::tr!("Plugin nicht gefunden", "Plugin not found"))?;
        self.load_entry(entry, info)
    }

    /// Erzeugt, aktiviert und setzt das Plugin in den Slot.
    fn load_entry(&mut self, entry: PluginEntry, info: PluginInfo) -> Result<(), String> {
        let id = CString::new(info.id.clone()).map_err(err)?;
        let mut instance = PluginInstance::<OdeHost>::new(
            |_| OdeShared {
                callback: AtomicBool::new(false),
            },
            |_| (),
            &entry,
            &id,
            &host_info(),
        )
        .map_err(err)?;

        let channels = main_channels(&mut instance)?;
        let latency = {
            let handle = instance.plugin_handle();
            handle
                .get_extension::<PluginLatency>()
                .map(|l| l.get(&handle))
                .unwrap_or(0)
        };
        let processor = instance
            .activate(
                |_, _| (),
                PluginAudioConfiguration {
                    sample_rate: ENGINE_RATE as f64,
                    min_frames_count: 1,
                    max_frames_count: MAX_BLOCK as u32,
                },
            )
            .map_err(err)?;
        let (params_tx, params_rx) = bounded(1024);
        let insert = ClapInsert::new(processor, channels, params_rx);
        self.slot.replace(Some(Box::new(insert)));
        self.loaded = Some(Loaded {
            info,
            instance,
            params_tx,
            pending: Vec::new(),
            latency,
            #[cfg(windows)]
            window: None,
            floating: false,
            _entry: entry,
        });
        Ok(())
    }

    fn unload(&mut self) {
        self.close_gui();
        let previous = self.slot.replace(None);
        let Some(mut loaded) = self.loaded.take() else {
            return;
        };
        if let Some(insert) = previous
            && let Ok(insert) = insert.into_any().downcast::<ClapInsert>()
        {
            // Der Audio-Thread hält es nicht mehr: hier anhalten und abbauen.
            let stopped = insert.processor.into_stopped();
            loaded.instance.deactivate(stopped);
        }
        drop(loaded);
    }

    fn params(&mut self) -> Result<Vec<ParamDesc>, String> {
        let Some(l) = &mut self.loaded else {
            return Ok(Vec::new());
        };
        let pending = l.pending.clone();
        let handle = l.instance.plugin_handle();
        let Some(params) = handle.get_extension::<PluginParams>() else {
            return Ok(Vec::new());
        };
        let mut buffer = ParamInfoBuffer::new();
        let mut text_buffer = [0u8; 128];
        let mut list = Vec::new();
        for index in 0..params.count(&handle) {
            let Some(info) = params.get_info(&handle, index, &mut buffer) else {
                continue;
            };
            if info.flags.contains(ParamInfoFlags::IS_HIDDEN) {
                continue;
            }
            let id = info.id;
            let value = pending
                .iter()
                .find(|(p, _)| *p == id.get())
                .map(|(_, v)| *v)
                .or_else(|| params.get_value(&handle, id))
                .unwrap_or(info.default_value);
            let text = params
                .value_to_text(&handle, id, value, &mut text_buffer)
                .map(|b| bytes_text(b))
                .unwrap_or_default();
            list.push(ParamDesc {
                id: id.get(),
                name: bytes_text(info.name),
                module: bytes_text(info.module),
                min: info.min_value,
                max: info.max_value,
                default: info.default_value,
                value,
                text,
                stepped: info.flags.contains(ParamInfoFlags::IS_STEPPED),
            });
        }
        Ok(list)
    }

    fn open_gui(&mut self) -> Result<(), String> {
        if self.window_open() {
            return Ok(());
        }
        let Some(l) = &mut self.loaded else {
            return Err(crate::tr!("Kein Plugin geladen", "No plugin loaded"));
        };
        let title = l.info.name.clone();
        let handle = l.instance.plugin_handle();
        let gui = handle
            .get_extension::<PluginGui>()
            .ok_or_else(|| crate::tr!("Das Plugin hat kein Fenster", "The plugin has no window"))?;
        let embedded = GuiConfiguration {
            api_type: GuiApiType::WIN32,
            is_floating: false,
        };
        let floating = GuiConfiguration {
            api_type: GuiApiType::WIN32,
            is_floating: true,
        };

        #[cfg(windows)]
        if gui.is_api_supported(&handle, embedded) {
            gui.create(&handle, embedded).map_err(err)?;
            let _ = gui.set_scale(&handle, 1.0);
            let size = gui.get_size(&handle).unwrap_or(GuiSize {
                width: 640,
                height: 400,
            });
            let host_window = window::HostWindow::open(&title, size.width, size.height)?;
            // SAFETY: Das Fenster lebt, bis die Oberfläche wieder abgebaut ist (close_gui).
            let parent = unsafe { Window::from_win32_hwnd(host_window.hwnd.0) };
            if let Err(e) = unsafe { gui.set_parent(&handle, parent) } {
                gui.destroy(&handle);
                return Err(err(e));
            }
            let _ = gui.show(&handle);
            host_window.show();
            l.window = Some(host_window);
            return Ok(());
        }

        if gui.is_api_supported(&handle, floating) {
            gui.create(&handle, floating).map_err(err)?;
            if let Ok(title) = CString::new(title) {
                gui.suggest_title(&handle, &title);
            }
            gui.show(&handle).map_err(err)?;
            l.floating = true;
            return Ok(());
        }
        Err(crate::tr!(
            "Die Oberfläche des Plugins wird nicht unterstützt",
            "The plugin's interface is not supported"
        ))
    }

    fn close_gui(&mut self) {
        let open = self.window_open();
        let Some(l) = &mut self.loaded else {
            return;
        };
        if !open {
            return;
        }
        let handle = l.instance.plugin_handle();
        if let Some(gui) = handle.get_extension::<PluginGui>() {
            let _ = gui.hide(&handle);
            gui.destroy(&handle);
        }
        #[cfg(windows)]
        {
            l.window = None;
        }
        l.floating = false;
    }
}

/// Kanäle des Haupt-Ein- und Ausgangs; ohne Angabe Stereo.
fn main_channels(instance: &mut PluginInstance<OdeHost>) -> Result<(usize, usize), String> {
    let handle = instance.plugin_handle();
    let Some(ports) = handle.get_extension::<PluginAudioPorts>() else {
        return Ok((2, 2));
    };
    let mut buffer = AudioPortInfoBuffer::default();
    let mut channels = |is_input: bool| {
        if ports.count(&handle, is_input) == 0 {
            return None;
        }
        ports
            .get(&handle, 0, is_input, &mut buffer)
            .map(|p| p.channel_count as usize)
    };
    match (channels(true), channels(false)) {
        (Some(i @ 1..=2), Some(o @ 1..=2)) => Ok((i, o)),
        (None, _) | (_, None) => Err(crate::tr!(
            "Das ist kein Effekt-Plugin (kein Audio-Ein- oder -Ausgang)",
            "This is not an effect plugin (no audio input or output)"
        )),
        _ => Err(crate::tr!(
            "Nur Mono- und Stereo-Plugins werden unterstützt",
            "Only mono and stereo plugins are supported"
        )),
    }
}

fn entries(path: &Path) -> Result<Vec<PluginInfo>, String> {
    // SAFETY: siehe `Worker::load`.
    let entry = unsafe { PluginEntry::load(path) }.map_err(err)?;
    Ok(descriptors(&entry, path))
}

fn scan() -> Vec<PluginInfo> {
    let mut files = Vec::new();
    for dir in search_dirs() {
        find_clap_files(&dir, &mut files, 0);
    }
    files.sort();
    files.dedup();
    files
        .iter()
        .filter_map(|f| entries(f).ok())
        .flatten()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loaded_worker() -> Worker {
        let mut worker = Worker::new(Arc::new(InsertSlot::default()));
        worker
            .handle(Request::Load {
                path: test_plugin::PATH.into(),
                id: test_plugin::ID.into(),
            })
            .unwrap();
        worker
    }

    #[test]
    fn hosts_a_plugin_in_the_slot() {
        let mut worker = loaded_worker();
        let slot = worker.slot.clone();
        let mut buf = vec![0.5f32; 2000];
        slot.process(&mut buf);
        assert!(buf.iter().all(|&s| (s - 0.5).abs() < 1e-6));

        // Parameter: Gain halbieren, über den Event-Weg im Audio-Thread.
        worker
            .handle(Request::SetParam {
                id: test_plugin::GAIN,
                value: 0.5,
            })
            .unwrap();
        let mut buf = vec![0.5f32; 480];
        slot.process(&mut buf);
        assert!(buf.iter().all(|&s| (s - 0.25).abs() < 1e-6));

        let params = worker.params().unwrap();
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].name, "Gain");
        assert!((params[0].value - 0.5).abs() < 1e-9);
        assert_eq!(params[0].text, "0.50x");

        let status = worker.status();
        assert_eq!(status.loaded.unwrap().id, test_plugin::ID);
        assert!(!status.has_gui);

        worker.handle(Request::Unload).unwrap();
        assert!(!slot.is_filled());
        let mut buf = vec![0.5f32; 16];
        slot.process(&mut buf);
        assert_eq!(buf, vec![0.5; 16]);
    }

    #[test]
    fn missing_gui_is_reported() {
        let mut worker = loaded_worker();
        assert!(worker.handle(Request::Gui { open: true }).is_err());
        worker.unload();
    }

    #[test]
    fn unknown_plugin_is_an_error() {
        let mut worker = Worker::new(Arc::new(InsertSlot::default()));
        assert!(
            worker
                .handle(Request::Load {
                    path: "C:/gibt/es/nicht.clap".into(),
                    id: "x".into(),
                })
                .is_err()
        );
    }
}
