//! Einschub-Platz für einen externen Effekt (Plugin) in der Mikrofon-Kette,
//! nach den Stimm-Effekten und vor dem Limiter. Die Engine kennt nur diese
//! Schnittstelle; wer den Platz füllt (z. B. der CLAP-Host), bleibt außen vor.

use std::any::Any;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

use super::dsp::AtomicF32;

/// Ein Effekt, der im Audio-Thread läuft. Mono, Engine-Rate, beliebige Blocklänge.
pub trait Insert: Send {
    fn process(&mut self, buf: &mut [f32]);
    /// Zum Zurückholen durch den Besitzer, der ihn eingesetzt hat.
    fn into_any(self: Box<Self>) -> Box<dyn Any + Send>;
}

#[derive(Default)]
pub struct InsertSlot {
    insert: Mutex<Option<Box<dyn Insert>>>,
    /// Durchschleifen, ohne das Plugin zu entladen.
    pub bypass: AtomicBool,
    /// Rechenzeit des Plugins im letzten Block in ms, für die Anzeige.
    pub load_ms: AtomicF32,
}

impl std::fmt::Debug for InsertSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InsertSlot")
            .field("bypass", &self.bypass.load(Ordering::Relaxed))
            .finish_non_exhaustive()
    }
}

impl InsertSlot {
    /// Setzt einen Effekt ein und gibt den vorigen zurück.
    pub fn replace(&self, insert: Option<Box<dyn Insert>>) -> Option<Box<dyn Insert>> {
        std::mem::replace(&mut *self.insert.lock(), insert)
    }

    pub fn is_filled(&self) -> bool {
        self.insert.lock().is_some()
    }

    /// Im Audio-Thread: blockiert nie. Ist der Platz gerade gesperrt (Tausch),
    /// läuft dieser Block trocken durch.
    pub fn process(&self, buf: &mut [f32]) {
        if self.bypass.load(Ordering::Relaxed) {
            return;
        }
        let Some(mut guard) = self.insert.try_lock() else {
            return;
        };
        if let Some(insert) = guard.as_mut() {
            let started = std::time::Instant::now();
            insert.process(buf);
            self.load_ms.store(started.elapsed().as_secs_f32() * 1000.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Half;

    impl Insert for Half {
        fn process(&mut self, buf: &mut [f32]) {
            buf.iter_mut().for_each(|s| *s *= 0.5);
        }
        fn into_any(self: Box<Self>) -> Box<dyn Any + Send> {
            self
        }
    }

    #[test]
    fn empty_and_bypassed_slots_pass_through() {
        let slot = InsertSlot::default();
        let mut buf = [1.0f32; 8];
        slot.process(&mut buf);
        assert_eq!(buf, [1.0; 8]);

        slot.replace(Some(Box::new(Half)));
        slot.process(&mut buf);
        assert_eq!(buf, [0.5; 8]);

        slot.bypass.store(true, Ordering::Relaxed);
        slot.process(&mut buf);
        assert_eq!(buf, [0.5; 8]);

        let old = slot.replace(None).unwrap();
        assert!(old.into_any().downcast::<Half>().is_ok());
    }
}
