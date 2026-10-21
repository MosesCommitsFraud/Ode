//! Stimm-Effekte: Tonhöhe und Formant, Autotune, Harmonizer, Vocoder,
//! Klangcharakter, Modulation, Echo und Hall. Läuft im Mikrofon-Pfad nach
//! der Aufbereitung (Gate bis Exciter) und vor dem Limiter, in fester
//! Reihenfolge:
//!
//! Tonhöhe/Autotune/Harmonizer → Vocoder → Charakter → Modulation → Echo → Hall

pub mod character;
pub mod modulation;
pub mod pitch;
pub mod preview;
pub mod space;
pub mod stretch;
pub mod vocoder;

use serde::{Deserialize, Serialize};

use super::ENGINE_RATE;
use super::dsp::{AtomicF32, DelayLine};
use character::{Character, CharacterParams};
use modulation::{Modulation, ModulationParams};
use pitch::{PitchDetector, note_of};
use space::{Echo, EchoParams, Reverb, ReverbParams};
use stretch::Stretch;
use vocoder::{BANDS, Vocoder, VocoderParams};

const RATE: f32 = ENGINE_RATE as f32;
/// So oft (in Samples) wird die Autotune-Korrektur nachgeführt: 2,5 ms.
const SUB: usize = 120;

// ------------------------------------------------------------ Parameter

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PitchParams {
    pub enabled: bool,
    /// Tonhöhe in Halbtönen, −12 bis +12.
    pub semitones: f32,
    /// Formanten (Klangfarbe) in Halbtönen, −8 bis +8; 0 = natürlich.
    pub formant: f32,
}

impl Default for PitchParams {
    fn default() -> Self {
        Self {
            enabled: false,
            semitones: 0.0,
            formant: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scale {
    #[default]
    Chromatic,
    Major,
    Minor,
    Pentatonic,
    Blues,
}

impl Scale {
    /// Erlaubte Tonstufen relativ zum Grundton.
    fn degrees(self) -> &'static [i32] {
        match self {
            Scale::Chromatic => &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            Scale::Major => &[0, 2, 4, 5, 7, 9, 11],
            Scale::Minor => &[0, 2, 3, 5, 7, 8, 10],
            Scale::Pentatonic => &[0, 2, 4, 7, 9],
            Scale::Blues => &[0, 3, 5, 6, 7, 10],
        }
    }

    pub fn contains(self, key: u8, note: i32) -> bool {
        let degree = (note - key as i32).rem_euclid(12);
        self.degrees().contains(&degree)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutotuneParams {
    pub enabled: bool,
    /// Grundton der Tonart, 0 = C … 11 = H.
    pub key: u8,
    pub scale: Scale,
    /// 0 = sofort (harter Roboter-Effekt), 1 = langsam und natürlich.
    pub speed: f32,
}

impl Default for AutotuneParams {
    fn default() -> Self {
        Self {
            enabled: false,
            key: 0,
            scale: Scale::Chromatic,
            speed: 0.3,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HarmonyVoice {
    pub enabled: bool,
    /// Abstand zur Stimme in Halbtönen, −12 bis +12.
    pub semitones: f32,
    /// Lautstärke 0–1.
    pub level: f32,
}

impl Default for HarmonyVoice {
    fn default() -> Self {
        Self {
            enabled: false,
            semitones: 4.0,
            level: 0.6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HarmonizerParams {
    pub enabled: bool,
    pub voices: [HarmonyVoice; 2],
}

impl Default for HarmonizerParams {
    fn default() -> Self {
        Self {
            enabled: false,
            voices: [
                HarmonyVoice {
                    enabled: true,
                    semitones: 4.0,
                    level: 0.6,
                },
                HarmonyVoice {
                    enabled: true,
                    semitones: 7.0,
                    level: 0.5,
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceParams {
    /// Hauptschalter aller Stimm-Effekte.
    pub enabled: bool,
    pub pitch: PitchParams,
    pub autotune: AutotuneParams,
    pub harmonizer: HarmonizerParams,
    pub vocoder: VocoderParams,
    pub character: CharacterParams,
    pub modulation: ModulationParams,
    pub echo: EchoParams,
    pub reverb: ReverbParams,
}

impl Default for VoiceParams {
    fn default() -> Self {
        Self {
            enabled: true,
            pitch: PitchParams::default(),
            autotune: AutotuneParams::default(),
            harmonizer: HarmonizerParams::default(),
            vocoder: VocoderParams::default(),
            character: CharacterParams::default(),
            modulation: ModulationParams::default(),
            echo: EchoParams::default(),
            reverb: ReverbParams::default(),
        }
    }
}

impl VoiceParams {
    pub fn clamped(mut self) -> Self {
        self.pitch.semitones = self.pitch.semitones.clamp(-12.0, 12.0);
        self.pitch.formant = self.pitch.formant.clamp(-8.0, 8.0);
        self.autotune.key = self.autotune.key.min(11);
        self.autotune.speed = self.autotune.speed.clamp(0.0, 1.0);
        for v in &mut self.harmonizer.voices {
            v.semitones = v.semitones.clamp(-12.0, 12.0);
            v.level = v.level.clamp(0.0, 1.0);
        }
        self.vocoder = self.vocoder.clamped();
        self.character = self.character.clamped();
        self.modulation = self.modulation.clamped();
        self.echo = self.echo.clamped();
        self.reverb = self.reverb.clamped();
        self
    }

    /// Braucht den Tonhöhen-Verschieber (und damit etwa 45 ms Verzögerung).
    pub fn shifts(&self) -> bool {
        self.enabled && (self.pitch.enabled || self.autotune.enabled || self.harmonizer.enabled)
    }
}

/// Anzeigewerte für die Oberfläche.
#[derive(Debug, Default)]
pub struct VoiceMeters {
    /// Erkannte Tonhöhe in Hz, 0 = stimmlos oder aus.
    pub pitch_hz: AtomicF32,
    /// Zielnote des Autotune (Midi), −1 = keine.
    pub target_note: AtomicF32,
    /// Aktuelle Korrektur des Autotune in Cent.
    pub correction_cents: AtomicF32,
    /// Zusätzliche Verzögerung durch die Stimm-Effekte in ms.
    pub latency_ms: AtomicF32,
    /// Pegel der Vocoder-Bänder (Höchstwert seit dem letzten Auslesen).
    pub vocoder: [AtomicF32; BANDS],
    /// Spitzenpegel ins Echo hinein und der Wiederholungen seit dem letzten Auslesen.
    pub echo: [AtomicF32; 2],
    /// Spitzenpegel in den Hall hinein und des Nachhalls seit dem letzten Auslesen.
    pub reverb: [AtomicF32; 2],
}

// ------------------------------------------------------------ Autotune

/// Um so viele Stücke (je 2,5 ms) wird die erkannte Tonhöhe verzögert, bevor
/// sie den Verschieber steuert: Der Detektor schaut auf jüngere Samples als
/// das Analysefenster des Verschiebers.
const TUNE_LAG: usize = 4;

/// Zustand des Autotune: Zielnote und die Tonhöhe, die herauskommen soll.
#[derive(Debug, Default)]
struct Tuner {
    target: Option<i32>,
    /// Gewünschte Ausgangs-Tonhöhe (Midi); gleitet zur Zielnote.
    out: Option<f32>,
    /// Wie lange (s) schon kein Ton erkannt wurde.
    silent: f32,
    cents: f32,
    /// Zuletzt angenommene Note, gegen Oktavsprünge der Erkennung.
    last: Option<f32>,
    /// Ein großer Sprung wurde einmal gesehen und wartet auf Bestätigung.
    jump: Option<f32>,
}

impl Tuner {
    /// Nächste erlaubte Note; die bisherige bleibt, bis eine andere klar näher liegt.
    fn snap(&mut self, note: f32, p: &AutotuneParams) -> i32 {
        let base = note.round() as i32;
        let nearest = (0..=12)
            .flat_map(|k| [base - k, base + k])
            .filter(|&n| p.scale.contains(p.key, n))
            .min_by(|&a, &b| (a as f32 - note).abs().total_cmp(&(b as f32 - note).abs()))
            .unwrap_or(base);
        let keep = self.target.filter(|&c| {
            p.scale.contains(p.key, c)
                && (c as f32 - note).abs() - (nearest as f32 - note).abs() < 0.15
        });
        let chosen = keep.unwrap_or(nearest);
        self.target = Some(chosen);
        chosen
    }

    /// Filtert einzelne Ausreißer: Ein Sprung um mehr als eine Quinte zählt
    /// erst, wenn die nächste Messung ihn bestätigt.
    fn steady(&mut self, note: f32) -> Option<f32> {
        match self.last {
            Some(last) if (note - last).abs() > 7.0 => {
                if self.jump.is_some_and(|j| (j - note).abs() < 1.0) {
                    self.jump = None;
                    self.last = Some(note);
                    Some(note)
                } else {
                    self.jump = Some(note);
                    None
                }
            }
            _ => {
                self.jump = None;
                self.last = Some(note);
                Some(note)
            }
        }
    }

    /// Korrekturfaktor für die erkannte Tonhöhe; ohne Ton bleibt die letzte
    /// Korrektur stehen, damit Konsonanten nicht springen. `dt` in s.
    ///
    /// Geglättet wird die Ausgangs-Tonhöhe, nicht die Korrektur: Sie gleitet
    /// zur Zielnote und bleibt dort, auch wenn die Stimme wackelt oder
    /// schwebt. Die Geschwindigkeit bestimmt nur, wie weich Notenwechsel sind.
    fn correction(&mut self, hz: Option<f32>, p: &AutotuneParams, dt: f32) -> f32 {
        match hz.map(note_of).and_then(|n| self.steady(n)) {
            Some(note) => {
                let target = self.snap(note, p) as f32;
                // Geschwindigkeit 0–1 → bis der Ton sitzt 0–400 ms (drei
                // Zeitkonstanten), quadratisch für feine Einstellung bei den
                // schnellen Werten.
                let tau = p.speed * p.speed * 0.4 / 3.0;
                // Ein neuer Ton beginnt dort, wo er gesungen wird.
                let out = self.out.unwrap_or(note);
                let out = if tau < 0.002 {
                    target
                } else {
                    out + (target - out) * (1.0 - (-dt / tau).exp())
                };
                self.out = Some(out);
                self.cents = (out - note) * 100.0;
                self.silent = 0.0;
            }
            // Nach einer Pause (Atmen, Konsonanten) setzt der nächste Ton neu an;
            // kurze Aussetzer der Erkennung überbrückt die Korrektur.
            None if hz.is_none() => {
                self.silent += dt;
                if self.silent > 0.08 {
                    self.out = None;
                }
            }
            None => {}
        }
        2f32.powf(self.cents / 1200.0)
    }
}

// ------------------------------------------------------------ Kette

pub struct VoiceChain {
    params: VoiceParams,
    detector: PitchDetector,
    /// Die eigene Stimme, verschoben (Tonhöhe, Formant, Autotune).
    main: Stretch,
    /// Zwei Harmonie-Stimmen; `true` = lief im letzten Block.
    harmony: [(Stretch, bool); 2],
    /// Trockene Stimme mit derselben Verzögerung, wenn nur Harmonien laufen.
    dry: DelayLine,
    input: Vec<f32>,
    output: Vec<f32>,
    shifting: bool,
    tuner: Tuner,
    /// Erkannte Tonhöhen der letzten Stücke, für `TUNE_LAG`.
    recent: [Option<f32>; TUNE_LAG + 1],
    recent_pos: usize,
    vocoder: Vocoder,
    character: Character,
    modulation: Modulation,
    echo: Echo,
    reverb: Reverb,
}

impl Default for VoiceChain {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceChain {
    pub fn new() -> Self {
        Self {
            params: VoiceParams {
                enabled: false,
                ..Default::default()
            },
            detector: PitchDetector::new(),
            main: Stretch::new(),
            harmony: [(Stretch::new(), false), (Stretch::new(), false)],
            dry: DelayLine::new(stretch::BLOCK * 4),
            input: vec![0.0; SUB],
            output: vec![0.0; SUB],
            shifting: false,
            tuner: Tuner::default(),
            recent: [None; TUNE_LAG + 1],
            recent_pos: 0,
            vocoder: Vocoder::new(),
            character: Character::new(),
            modulation: Modulation::new(),
            echo: Echo::new(),
            reverb: Reverb::new(),
        }
    }

    /// Übernimmt neue Einstellungen; frisch eingeschaltete Effekte starten leer.
    pub fn configure(&mut self, p: &VoiceParams) {
        let old = self.params;
        let switched_on = |was: bool, now: bool| now && !was;
        if switched_on(
            old.enabled && old.character.enabled,
            p.enabled && p.character.enabled,
        ) {
            self.character.clear();
        }
        if p.character != old.character {
            self.character.configure(&p.character);
        }
        if switched_on(
            old.enabled && old.vocoder.enabled,
            p.enabled && p.vocoder.enabled,
        ) {
            self.vocoder.clear();
        }
        if switched_on(
            old.enabled && old.modulation.enabled,
            p.enabled && p.modulation.enabled,
        ) {
            self.modulation.clear(&p.modulation);
        }
        if switched_on(old.enabled && old.echo.enabled, p.enabled && p.echo.enabled) {
            self.echo.clear();
        }
        if p.echo != old.echo {
            self.echo.configure(&p.echo);
        }
        if switched_on(
            old.enabled && old.reverb.enabled,
            p.enabled && p.reverb.enabled,
        ) {
            self.reverb.clear();
        }
        if p.reverb != old.reverb {
            self.reverb.configure(&p.reverb);
        }
        if !old.autotune.enabled && p.autotune.enabled {
            self.tuner = Tuner::default();
            self.recent = [None; TUNE_LAG + 1];
        }
        self.params = *p;
    }

    pub fn process(&mut self, buf: &mut [f32], meters: &VoiceMeters) {
        let p = self.params;
        let shifts = p.shifts();
        let detects = shifts || (p.enabled && p.vocoder.enabled && p.vocoder.follow);
        meters.latency_ms.store(if shifts {
            self.main.latency() as f32 * 1000.0 / RATE
        } else {
            0.0
        });
        if !p.enabled {
            self.shifting = false;
            meters.pitch_hz.store(0.0);
            meters.target_note.store(-1.0);
            return;
        }

        if shifts && !self.shifting {
            self.main.reset();
            self.dry.clear();
            for (h, on) in &mut self.harmony {
                h.reset();
                *on = false;
            }
        }
        self.shifting = shifts;
        if detects {
            if shifts {
                self.shift(buf, &p);
            } else {
                buf.iter().for_each(|&x| self.detector.push(x));
            }
        } else {
            self.detector.reset();
        }
        meters.pitch_hz.store(if detects {
            self.detector.frequency().unwrap_or(0.0)
        } else {
            0.0
        });
        let tuned = p.autotune.enabled && shifts;
        meters.target_note.store(match self.tuner.target {
            Some(n) if tuned => n as f32,
            _ => -1.0,
        });
        meters
            .correction_cents
            .store(if tuned { self.tuner.cents } else { 0.0 });

        if p.vocoder.enabled {
            let pitch = self.detector.frequency();
            self.vocoder.process(buf, &p.vocoder, pitch);
            for (meter, level) in meters.vocoder.iter().zip(self.vocoder.take_levels()) {
                meter.fetch_max(level);
            }
        }
        if p.character.enabled {
            self.character.process(buf);
        }
        if p.modulation.enabled {
            self.modulation.process(buf, &p.modulation);
        }
        if p.echo.enabled {
            let (input, wet) = self.echo.process(buf);
            meters.echo[0].fetch_max(input);
            meters.echo[1].fetch_max(wet);
        }
        if p.reverb.enabled {
            let (input, wet) = self.reverb.process(buf);
            meters.reverb[0].fetch_max(input);
            meters.reverb[1].fetch_max(wet);
        }
    }

    /// Tonhöhe, Formant, Autotune und Harmonizer über Signalsmith Stretch.
    /// Läuft in kurzen Stücken, damit Autotune schnell nachführt.
    fn shift(&mut self, buf: &mut [f32], p: &VoiceParams) {
        let main_shifts = p.pitch.enabled || p.autotune.enabled;
        let (semitones, formant) = if p.pitch.enabled {
            (p.pitch.semitones, p.pitch.formant)
        } else {
            (0.0, 0.0)
        };
        let shift_ratio = 2f32.powf(semitones / 12.0);
        // Formanten bleiben beim Transponieren an ihrem Platz; der Regler
        // verschiebt sie gezielt (Klangfarbe).
        self.main.set_formant(formant, true);
        let harmonies = p.harmonizer.voices.map(|v| {
            (p.harmonizer.enabled && v.enabled && v.level > 0.0)
                .then(|| (2f32.powf(v.semitones / 12.0), v.level))
        });
        let latency = self.main.latency();

        for chunk in buf.chunks_mut(SUB) {
            let n = chunk.len();
            for &x in chunk.iter() {
                self.detector.push(x);
                self.dry.push(x);
            }
            let hz = self.detector.frequency();
            self.recent[self.recent_pos] = hz;
            self.recent_pos = (self.recent_pos + 1) % self.recent.len();
            let auto = if p.autotune.enabled {
                // Der älteste Eintrag liegt `TUNE_LAG` Stücke zurück.
                let lagged = self.recent[self.recent_pos];
                self.tuner.correction(lagged, &p.autotune, n as f32 / RATE)
            } else {
                1.0
            };
            let ratio = shift_ratio * auto;
            self.input[..n].copy_from_slice(chunk);

            if main_shifts {
                self.main.set_formant_base(hz);
                self.main.set_transpose(ratio);
                self.main.process(&self.input[..n], &mut self.output[..n]);
                chunk.copy_from_slice(&self.output[..n]);
            } else {
                for (i, s) in chunk.iter_mut().enumerate() {
                    *s = self.dry.tap(latency + n - 1 - i);
                }
            }

            for ((stretch, running), harmony) in self.harmony.iter_mut().zip(harmonies) {
                let Some((interval, level)) = harmony else {
                    *running = false;
                    continue;
                };
                if !*running {
                    stretch.reset();
                    *running = true;
                }
                stretch.set_formant(formant, true);
                stretch.set_formant_base(hz);
                stretch.set_transpose(ratio * interval);
                stretch.process(&self.input[..n], &mut self.output[..n]);
                for (s, h) in chunk.iter_mut().zip(&self.output[..n]) {
                    *s += h * level;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    fn saw(freq: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| ((i as f32 * freq / RATE).fract() * 2.0 - 1.0) * 0.3)
            .collect()
    }

    fn run(params: VoiceParams, input: &[f32]) -> (Vec<f32>, VoiceMeters) {
        let meters = VoiceMeters::default();
        let mut chain = VoiceChain::new();
        chain.configure(&params.clamped());
        let mut out = Vec::new();
        for block in input.chunks(480) {
            let mut b = block.to_vec();
            chain.process(&mut b, &meters);
            out.extend(b);
        }
        (out, meters)
    }

    fn detect(signal: &[f32]) -> f32 {
        let mut d = PitchDetector::new();
        let mut found = Vec::new();
        for (i, &x) in signal.iter().enumerate() {
            d.push(x);
            if i > signal.len() / 2 && i % 240 == 0 {
                found.push(d.frequency().unwrap_or(0.0));
            }
        }
        found.iter().sum::<f32>() / found.len() as f32
    }

    #[test]
    fn default_is_transparent() {
        let input: Vec<f32> = (0..9_600)
            .map(|i| (i as f32 * TAU * 440.0 / RATE).sin() * 0.5)
            .collect();
        let (out, meters) = run(VoiceParams::default(), &input);
        assert_eq!(out, input);
        assert_eq!(meters.latency_ms.load(), 0.0);
    }

    #[test]
    fn autotune_pulls_to_nearest_note() {
        // 228 Hz liegt zwischen A3 (220) und A#3 (233,1), näher an A#3.
        let mut p = VoiceParams::default();
        p.autotune.enabled = true;
        p.autotune.speed = 0.0;
        let (out, meters) = run(p, &saw(228.0, 48_000));
        let got = detect(&out);
        assert!((got / 233.08 - 1.0).abs() < 0.01, "{got}");
        assert_eq!(meters.target_note.load(), 58.0);
    }

    #[test]
    fn autotune_respects_the_scale() {
        // A#3 gehört nicht zu C-Dur: zieht auf A3 oder H3; 230 Hz liegt näher an A.
        let mut p = VoiceParams::default();
        p.autotune.enabled = true;
        p.autotune.speed = 0.0;
        p.autotune.scale = Scale::Major;
        let (out, _) = run(p, &saw(230.0, 48_000));
        let got = detect(&out);
        assert!((got / 220.0 - 1.0).abs() < 0.01, "{got}");
    }

    #[test]
    fn pitch_shift_by_semitones() {
        let mut p = VoiceParams::default();
        p.pitch.enabled = true;
        p.pitch.semitones = 7.0;
        let (out, meters) = run(p, &saw(200.0, 48_000));
        let got = detect(&out);
        assert!((got / (200.0 * 1.4983) - 1.0).abs() < 0.01, "{got}");
        assert!(meters.latency_ms.load() > 20.0);
    }

    #[test]
    fn harmonizer_keeps_the_voice() {
        let mut p = VoiceParams::default();
        p.harmonizer.enabled = true;
        let input = saw(200.0, 48_000);
        let (out, _) = run(p, &input);
        let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
        assert!(rms(&out[24_000..]) > rms(&input[24_000..]));
        assert!(out.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn every_effect_at_once_stays_finite() {
        let mut p = VoiceParams::default();
        p.pitch.enabled = true;
        p.pitch.semitones = -5.0;
        p.pitch.formant = 3.0;
        p.autotune.enabled = true;
        p.harmonizer.enabled = true;
        p.vocoder.enabled = true;
        p.vocoder.follow = true;
        p.character.enabled = true;
        p.modulation.enabled = true;
        p.echo.enabled = true;
        p.reverb.enabled = true;
        let (out, _) = run(p, &saw(180.0, 48_000));
        assert!(out.iter().all(|s| s.is_finite() && s.abs() < 8.0));
    }
}

#[cfg(test)]
mod measure {
    use super::*;
    use std::f32::consts::TAU;

    /// Gesungener Vokal: Glottis-Pulse durch drei Formanten, mit Gleiten und Vibrato.
    fn sung(len: usize) -> Vec<f32> {
        let mut phase = 0.0f32;
        let mut f = [
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 700.0, 5.0, 0.0),
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 1200.0, 6.0, 0.0),
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 2600.0, 7.0, 0.0),
        ];
        (0..len)
            .map(|i| {
                let t = i as f32 / RATE;
                let hz = 196.0 * 2f32.powf((t * 0.5).sin() * 0.3 + (t * TAU * 5.5).sin() * 0.02);
                phase = (phase + hz / RATE).fract();
                let pulse = if phase < 0.08 { 1.0 } else { -0.087 };
                (f[0].process(pulse) + f[1].process(pulse) * 0.6 + f[2].process(pulse) * 0.3) * 0.25
            })
            .collect()
    }

    /// Gesungene Melodie: gehaltene Töne je 0,6 s, jeder etwas verstimmt,
    /// mit Vibrato und kurzem Gleiten dazwischen.
    fn melody(len: usize) -> Vec<f32> {
        // (Midi-Note, Verstimmung in Halbtönen)
        const NOTES: [(f32, f32); 6] = [
            (55.0, 0.35),
            (57.0, -0.3),
            (59.0, 0.25),
            (60.0, -0.4),
            (57.0, 0.3),
            (55.0, -0.25),
        ];
        let mut phase = 0.0f32;
        let mut f = [
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 700.0, 5.0, 0.0),
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 1200.0, 6.0, 0.0),
            crate::audio::dsp::Biquad::new(crate::audio::dsp::Shape::BandPass, 2600.0, 7.0, 0.0),
        ];
        let mut note = NOTES[0].0 + NOTES[0].1;
        (0..len)
            .map(|i| {
                let t = i as f32 / RATE;
                let (n, off) = NOTES[(t / 0.6) as usize % NOTES.len()];
                // Gleiten mit etwa 40 ms Zeitkonstante.
                note += (n + off - note) * (1.0 / (0.04 * RATE));
                let hz = pitch::hz_of(note + (t * TAU * 5.5).sin() * 0.2);
                phase = (phase + hz / RATE).fract();
                let pulse = if phase < 0.08 { 1.0 } else { -0.087 };
                (f[0].process(pulse) + f[1].process(pulse) * 0.6 + f[2].process(pulse) * 0.3) * 0.25
            })
            .collect()
    }

    /// Mittlerer Abstand (Cent) der erkannten Tonhöhe zum nächsten Halbton,
    /// nach der ersten Sekunde.
    fn off_key(signal: &[f32]) -> f32 {
        let mut d = PitchDetector::new();
        let mut cents = Vec::new();
        for (i, &x) in signal.iter().enumerate() {
            d.push(x);
            if i > 48_000
                && i % 240 == 0
                && let Some(hz) = d.frequency()
            {
                let n = note_of(hz);
                cents.push((n - n.round()).abs() * 100.0);
            }
        }
        cents.iter().sum::<f32>() / cents.len() as f32
    }

    fn tuned(speed: f32, input: &[f32]) -> Vec<f32> {
        let mut p = VoiceParams::default();
        p.autotune.enabled = true;
        p.autotune.speed = speed;
        let meters = VoiceMeters::default();
        let mut chain = VoiceChain::new();
        chain.configure(&p);
        let mut out = Vec::new();
        for block in input.chunks(480) {
            let mut b = block.to_vec();
            chain.process(&mut b, &meters);
            out.extend(b);
        }
        out
    }

    #[test]
    fn autotune_holds_a_wavering_voice_on_the_note() {
        // Verstimmte Töne mit Vibrato: im Schnitt fast 30 Cent daneben.
        // Langsamer heißt weichere Notenwechsel, gehaltene Töne sitzen trotzdem.
        let input = melody(48_000 * 4);
        let before = off_key(&input);
        for (speed, limit) in [(0.0, 7.0), (0.3, 8.0), (0.55, 14.0)] {
            let after = off_key(&tuned(speed, &input));
            assert!(after < limit, "speed {speed}: {before} → {after} Cent");
        }
    }

    #[test]
    #[ignore]
    fn measure_autotune() {
        let input = melody(48_000 * 4);
        println!("ungestimmt {:.1} Cent", off_key(&input));
        for speed in [0.0, 0.3, 0.55, 1.0] {
            println!("speed {speed}: {:.1} Cent", off_key(&tuned(speed, &input)));
        }
    }

    #[test]
    #[ignore]
    fn measure_engine() {
        let input = sung(48_000 * 4);
        let mut p = VoiceParams::default();
        p.autotune.enabled = true;
        p.autotune.speed = 0.0;
        p.harmonizer.enabled = true;
        let meters = VoiceMeters::default();
        let mut chain = VoiceChain::new();
        chain.configure(&p);
        let mut out = Vec::new();
        let mut worst = 0.0f64;
        let mut total = 0.0f64;
        for block in input.chunks(480) {
            let mut b = block.to_vec();
            let t = std::time::Instant::now();
            chain.process(&mut b, &meters);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            worst = worst.max(ms);
            total += ms;
            out.extend(b);
        }
        let blocks = input.len() / 480;
        // Lücken: 10-ms-Fenster nach der Einschwingzeit, die fast still sind.
        let gaps = out[48_000..]
            .chunks(480)
            .filter(|c| c.iter().map(|x| x * x).sum::<f32>() / 480.0 < 1e-6)
            .count();
        println!(
            "latency {:.1} ms, avg {:.3} ms/block, worst {:.3} ms/block (budget 10 ms), silent blocks {gaps}",
            meters.latency_ms.load(),
            total / blocks as f64,
            worst
        );
    }
}
