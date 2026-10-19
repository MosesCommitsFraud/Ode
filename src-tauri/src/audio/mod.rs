//! Audio-Engine: Alle Quellen laufen hier zusammen. Die Oberfläche steuert
//! die Engine nur über Befehle; Audio selbst läuft nie durch die Oberfläche.

pub mod app_icon;
pub mod deck;
pub mod decode;
pub mod devices;
pub mod dsp;
pub mod effects;
pub mod engine;
pub mod live;
pub mod mixer;
pub mod resample;
pub mod sampler;

/// Interne Abtastrate der Engine.
pub const ENGINE_RATE: u32 = 48_000;

/// Blockgröße: 10 ms bei 48 kHz, passend zu RNNoise.
pub const BLOCK_FRAMES: usize = 480;
