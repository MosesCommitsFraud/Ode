//! fundsp im Audio-Thread. Laufende Werte (Mischung, Zeiten, Frequenzen)
//! fließen über `Shared` direkt in den Graphen. Bausteine mit festen
//! Parametern (Raumgröße eines Halls, Art einer Modulation) werden neu gebaut,
//! sobald der Wert kurz stillsteht, und weich übergeblendet – so knackt nichts,
//! und beim Ziehen eines Reglers entsteht nicht bei jedem Bild ein neuer Graph.

use fundsp::prelude32::*;

use super::ENGINE_RATE;

/// Ein fertig eingerichteter Graph für 48 kHz.
pub fn unit(mut node: Box<dyn AudioUnit>) -> Box<dyn AudioUnit> {
    node.set_sample_rate(ENGINE_RATE as f64);
    node.allocate();
    node
}

/// So lange muss ein fester Parameter gleich bleiben, bevor neu gebaut wird.
const SETTLE: usize = (ENGINE_RATE as usize) * 15 / 100;
/// Überblendung zwischen altem und neuem Graphen.
const FADE: usize = (ENGINE_RATE as usize) * 30 / 1000;

/// Graph mit festen Parametern `K`, der bei Änderungen neu gebaut wird.
pub struct Rebuilt<K: Copy + PartialEq> {
    key: K,
    wanted: K,
    settle: usize,
    unit: Box<dyn AudioUnit>,
    old: Option<Box<dyn AudioUnit>>,
    fade: usize,
    build: fn(K) -> Box<dyn AudioUnit>,
}

impl<K: Copy + PartialEq> Rebuilt<K> {
    pub fn new(key: K, build: fn(K) -> Box<dyn AudioUnit>) -> Self {
        Self {
            key,
            wanted: key,
            settle: 0,
            unit: unit(build(key)),
            old: None,
            fade: 0,
            build,
        }
    }

    /// Neue feste Parameter; gebaut wird erst, wenn sie eine Weile gleich bleiben.
    pub fn want(&mut self, key: K) {
        if key != self.wanted {
            self.wanted = key;
            self.settle = 0;
        }
    }

    /// Sofort umbauen, ohne zu warten und ohne Überblendung – für frisch
    /// eingeschaltete Geräte, die noch nichts klingen lassen.
    pub fn set_now(&mut self, key: K) {
        self.wanted = key;
        if key != self.key {
            self.unit = unit((self.build)(key));
            self.key = key;
        }
        self.old = None;
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        if self.wanted != self.key && self.old.is_none() {
            self.settle += 1;
            if self.settle >= SETTLE {
                let fresh = unit((self.build)(self.wanted));
                self.old = Some(std::mem::replace(&mut self.unit, fresh));
                self.key = self.wanted;
                self.fade = 0;
            }
        }
        let y = self.unit.filter_mono(x);
        let Some(old) = &mut self.old else {
            return y;
        };
        let t = self.fade as f32 / FADE as f32;
        let out = old.filter_mono(x) * (1.0 - t) + y * t;
        self.fade += 1;
        if self.fade >= FADE {
            self.old = None;
        }
        out
    }

    pub fn reset(&mut self) {
        self.unit.reset();
        self.old = None;
    }
}

/// Graph, der einmal gebaut wird und nur über `Shared` gesteuert wird.
pub struct Fixed {
    unit: Box<dyn AudioUnit>,
}

impl Fixed {
    pub fn new(node: Box<dyn AudioUnit>) -> Self {
        Self { unit: unit(node) }
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        self.unit.filter_mono(x)
    }

    pub fn reset(&mut self) {
        self.unit.reset();
    }
}
