//! Audio zwischen Ode und dem Plugin-Hilfsprozess: ein gemeinsamer
//! Speicherbereich mit Ein- und Ausgangspuffer und zwei Windows-Events.
//!
//! Ode schreibt einen Block, zählt `request` hoch und weckt den Hilfsprozess;
//! der rechnet, setzt `done` auf dieselbe Nummer und weckt Ode. Kommt die
//! Antwort nicht rechtzeitig, läuft der Block trocken durch. Solange der
//! Hilfsprozess noch am vorigen Block rechnet, schreibt Ode nichts Neues
//! hinein; so überschreibt niemand Daten, die der andere gerade liest.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows::Win32::System::Memory::{
    CreateFileMappingW, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile,
    OpenFileMappingW, PAGE_READWRITE, UnmapViewOfFile,
};
use windows::Win32::System::Threading::{
    CreateEventW, EVENT_MODIFY_STATE, OpenEventW, SYNCHRONIZATION_SYNCHRONIZE, SetEvent,
    WaitForSingleObject,
};
use windows::core::HSTRING;

/// Größter Block pro Durchgang; längere werden geteilt.
pub const MAX_FRAMES: usize = 4096;

#[repr(C)]
struct Layout {
    request: AtomicU32,
    done: AtomicU32,
    frames: AtomicU32,
    _reserved: u32,
    input: [f32; MAX_FRAMES],
    output: [f32; MAX_FRAMES],
}

/// Ergebnis eines Durchgangs auf der Seite von Ode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundTrip {
    /// Der Block wurde verarbeitet.
    Done,
    /// Der Hilfsprozess rechnet noch am vorigen Block.
    Busy,
    /// Keine Antwort in der Zeit.
    Timeout,
}

pub struct SharedAudio {
    mapping: HANDLE,
    view: *mut Layout,
    request_event: HANDLE,
    done_event: HANDLE,
}

// SAFETY: Der Speicher wird nur über die Atomics und das Request/Done-Protokoll
// geteilt; die Handles sind prozessweit gültig.
unsafe impl Send for SharedAudio {}
unsafe impl Sync for SharedAudio {}

fn names(name: &str) -> (HSTRING, HSTRING, HSTRING) {
    (
        HSTRING::from(format!("Local\\{name}-mem")),
        HSTRING::from(format!("Local\\{name}-req")),
        HSTRING::from(format!("Local\\{name}-done")),
    )
}

fn os(e: windows::core::Error) -> String {
    e.message().to_string()
}

impl SharedAudio {
    /// Ode-Seite: legt Speicher und Events an.
    pub fn create(name: &str) -> Result<Self, String> {
        let (mem, req, done) = names(name);
        let size = std::mem::size_of::<Layout>() as u32;
        unsafe {
            let mapping =
                CreateFileMappingW(INVALID_HANDLE_VALUE, None, PAGE_READWRITE, 0, size, &mem)
                    .map_err(os)?;
            let view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0);
            if view.Value.is_null() {
                let _ = CloseHandle(mapping);
                return Err("MapViewOfFile".into());
            }
            // Auto-Reset-Events, anfangs nicht gesetzt.
            let request_event = CreateEventW(None, false, false, &req).map_err(os)?;
            let done_event = CreateEventW(None, false, false, &done).map_err(os)?;
            Ok(Self {
                mapping,
                view: view.Value.cast(),
                request_event,
                done_event,
            })
        }
    }

    /// Hilfsprozess-Seite: öffnet, was Ode angelegt hat.
    pub fn open(name: &str) -> Result<Self, String> {
        let (mem, req, done) = names(name);
        let access = SYNCHRONIZATION_SYNCHRONIZE | EVENT_MODIFY_STATE;
        unsafe {
            let mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, &mem).map_err(os)?;
            let view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0);
            if view.Value.is_null() {
                let _ = CloseHandle(mapping);
                return Err("MapViewOfFile".into());
            }
            let request_event = OpenEventW(access, false, &req).map_err(os)?;
            let done_event = OpenEventW(access, false, &done).map_err(os)?;
            Ok(Self {
                mapping,
                view: view.Value.cast(),
                request_event,
                done_event,
            })
        }
    }

    fn layout(&self) -> &Layout {
        // SAFETY: Die Abbildung lebt so lange wie `self`.
        unsafe { &*self.view }
    }

    /// Ode-Seite, im Audio-Thread: Block hinschicken und auf das Ergebnis
    /// warten, höchstens `timeout`. Ohne Erfolg bleibt `buf` unverändert.
    pub fn round_trip(&self, buf: &mut [f32], timeout: Duration) -> RoundTrip {
        let layout = self.layout();
        let request = layout.request.load(Ordering::Relaxed);
        if layout.done.load(Ordering::Acquire) != request {
            return RoundTrip::Busy;
        }
        let n = buf.len().min(MAX_FRAMES);
        // SAFETY: Der Hilfsprozess liest den Eingang erst nach `request`.
        unsafe {
            std::ptr::copy_nonoverlapping(buf.as_ptr(), (*self.view).input.as_mut_ptr(), n);
        }
        layout.frames.store(n as u32, Ordering::Relaxed);
        let seq = request.wrapping_add(1);
        layout.request.store(seq, Ordering::Release);
        unsafe {
            let _ = SetEvent(self.request_event);
        }

        // Ein verspätetes Signal eines früheren Blocks kann zuerst kommen:
        // weiter warten, bis die eigene Nummer da ist oder die Zeit um ist.
        let deadline = Instant::now() + timeout;
        loop {
            if layout.done.load(Ordering::Acquire) == seq {
                // SAFETY: `done` sagt, dass der Ausgang fertig geschrieben ist.
                unsafe {
                    std::ptr::copy_nonoverlapping(
                        (*self.view).output.as_ptr(),
                        buf.as_mut_ptr(),
                        n,
                    );
                }
                return RoundTrip::Done;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return RoundTrip::Timeout;
            }
            let ms = left.as_millis().max(1) as u32;
            unsafe {
                if WaitForSingleObject(self.done_event, ms) != WAIT_OBJECT_0
                    && layout.done.load(Ordering::Acquire) != seq
                {
                    return RoundTrip::Timeout;
                }
            }
        }
    }

    /// Hilfsprozess-Seite: wartet auf Blöcke und lässt `process` sie
    /// bearbeiten, bis `stop` gesetzt ist.
    pub fn serve(&self, stop: &AtomicBool, mut process: impl FnMut(&mut [f32])) {
        let layout = self.layout();
        while !stop.load(Ordering::Relaxed) {
            unsafe {
                WaitForSingleObject(self.request_event, 100);
            }
            let request = layout.request.load(Ordering::Acquire);
            if layout.done.load(Ordering::Relaxed) == request {
                continue;
            }
            let n = (layout.frames.load(Ordering::Relaxed) as usize).min(MAX_FRAMES);
            // SAFETY: Ode schreibt erst wieder, wenn `done` gleich `request` ist.
            let output = unsafe {
                let view = &mut *self.view;
                view.output[..n].copy_from_slice(&view.input[..n]);
                &mut view.output[..n]
            };
            process(output);
            layout.done.store(request, Ordering::Release);
            unsafe {
                let _ = SetEvent(self.done_event);
            }
        }
    }
}

impl Drop for SharedAudio {
    fn drop(&mut self) {
        unsafe {
            let _ = UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS {
                Value: self.view.cast(),
            });
            let _ = CloseHandle(self.mapping);
            let _ = CloseHandle(self.request_event);
            let _ = CloseHandle(self.done_event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn unique(tag: &str) -> String {
        format!(
            "ode-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        )
    }

    #[test]
    fn blocks_go_round_trip() {
        let name = unique("trip");
        let parent = SharedAudio::create(&name).unwrap();
        let child = Arc::new(SharedAudio::open(&name).unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let (child, stop) = (child.clone(), stop.clone());
            std::thread::spawn(move || child.serve(&stop, |b| b.iter_mut().for_each(|s| *s *= 2.0)))
        };
        for i in 0..50 {
            let mut buf = vec![i as f32; 480];
            assert_eq!(
                parent.round_trip(&mut buf, Duration::from_millis(500)),
                RoundTrip::Done
            );
            assert!(buf.iter().all(|&s| s == i as f32 * 2.0));
        }
        stop.store(true, Ordering::Relaxed);
        worker.join().unwrap();
    }

    #[test]
    fn silent_partner_leaves_the_block_dry() {
        let name = unique("silent");
        let parent = SharedAudio::create(&name).unwrap();
        let mut buf = vec![0.25f32; 480];
        assert_eq!(
            parent.round_trip(&mut buf, Duration::from_millis(5)),
            RoundTrip::Timeout
        );
        assert!(buf.iter().all(|&s| s == 0.25));
        // Der vorige Block ist noch offen: nichts Neues hineinschreiben.
        assert_eq!(
            parent.round_trip(&mut buf, Duration::from_millis(5)),
            RoundTrip::Busy
        );
    }
}
