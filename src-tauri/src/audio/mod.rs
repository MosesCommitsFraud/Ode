//! Audio-Engine: Alle Quellen laufen hier zusammen. Die Oberfläche steuert
//! die Engine nur über Befehle; Audio selbst läuft nie durch die Oberfläche.

pub mod devices;
pub mod dsp;
pub mod engine;
pub mod mixer;
pub mod resample;

/// Interne Abtastrate der Engine.
pub const ENGINE_RATE: u32 = 48_000;

/// Blockgröße: 10 ms bei 48 kHz, passend zu RNNoise.
pub const BLOCK_FRAMES: usize = 480;
