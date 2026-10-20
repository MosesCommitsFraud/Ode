//! Effekt-Busse des Pults: ein gemeinsamer Hall und ein gemeinsames Echo,
//! auf die jeder Kanal mit eigenem Anteil schickt (Send), dazu ein
//! Klang-EQ mit Low- und High-Cut für Soundboard, Musik und Live. Jeder
//! Ausgang rechnet seine eigene Kopie, damit das Routing erhalten bleibt.

use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::dsp::{Biquad, Shape};
use super::mixer::ChannelId;
use super::voice::space::{Echo, EchoParams, Reverb, ReverbParams};

/// Unterhalb davon ist der Low-Cut aus.
pub const LOW_CUT_OFF: f32 = 20.0;
/// Oberhalb davon ist der High-Cut aus.
pub const HIGH_CUT_OFF: f32 = 20_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelFx {
    /// Klang-EQ samt Low- und High-Cut.
    pub eq_enabled: bool,
    pub low_db: f32,
    pub mid_db: f32,
    pub high_db: f32,
    pub low_cut_hz: f32,
    pub high_cut_hz: f32,
    /// Anteil auf dem Hall-Bus, 0–1.
    pub reverb_send: f32,
    /// Anteil auf dem Echo-Bus, 0–1.
    pub echo_send: f32,
}

impl Default for ChannelFx {
    fn default() -> Self {
        Self {
            eq_enabled: false,
            low_db: 0.0,
            mid_db: 0.0,
            high_db: 0.0,
            low_cut_hz: LOW_CUT_OFF,
            high_cut_hz: HIGH_CUT_OFF,
            reverb_send: 0.0,
            echo_send: 0.0,
        }
    }
}

impl ChannelFx {
    fn clamped(mut self) -> Self {
        for db in [&mut self.low_db, &mut self.mid_db, &mut self.high_db] {
            *db = db.clamp(-12.0, 12.0);
        }
        self.low_cut_hz = self.low_cut_hz.clamp(LOW_CUT_OFF, 1_000.0);
        self.high_cut_hz = self.high_cut_hz.clamp(1_000.0, HIGH_CUT_OFF);
        self.reverb_send = self.reverb_send.clamp(0.0, 1.0);
        self.echo_send = self.echo_send.clamp(0.0, 1.0);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelFxSet {
    pub mic: ChannelFx,
    pub soundboard: ChannelFx,
    pub music: ChannelFx,
    pub live: ChannelFx,
}

impl ChannelFxSet {
    pub fn get(&self, id: ChannelId) -> &ChannelFx {
        match id {
            ChannelId::Mic => &self.mic,
            ChannelId::Soundboard => &self.soundboard,
            ChannelId::Music => &self.music,
            ChannelId::Live => &self.live,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BusParams {
    /// Hall-Bus; `mix` ist hier die Rückführung (Return) 0–1.
    pub reverb: ReverbParams,
    /// Echo-Bus; `mix` ist die Rückführung 0–1.
    pub echo: EchoParams,
    pub channels: ChannelFxSet,
}

impl Default for BusParams {
    fn default() -> Self {
        Self {
            reverb: ReverbParams {
                enabled: true,
                size: 0.7,
                damping: 0.5,
                predelay_ms: 25.0,
                low_cut_hz: 250.0,
                mix: 0.8,
            },
            echo: EchoParams {
                enabled: true,
                time_ms: 350.0,
                feedback: 0.35,
                tone_hz: 3_500.0,
                mix: 0.8,
            },
            channels: ChannelFxSet::default(),
        }
    }
}

impl BusParams {
    fn clamped(mut self) -> Self {
        self.reverb = self.reverb.clamped();
        self.echo = self.echo.clamped();
        for fx in [
            &mut self.channels.mic,
            &mut self.channels.soundboard,
            &mut self.channels.music,
            &mut self.channels.live,
        ] {
            *fx = fx.clamped();
        }
        self
    }
}

/// Zwischen Steuerung und Ausgängen geteilt.
#[derive(Debug, Default)]
pub struct BusShared {
    params: Mutex<BusParams>,
    version: AtomicU64,
}

impl BusShared {
    pub fn set(&self, params: BusParams) {
        *self.params.lock() = params.clamped();
        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn params(&self) -> BusParams {
        *self.params.lock()
    }
}

/// Klang-EQ eines Kanals: Tiefen, Präsenz, Höhen, Low-Cut, High-Cut.
#[derive(Debug, Clone, Copy, Default)]
struct ChannelEq {
    bands: [Biquad; 3],
    low_cut: Option<Biquad>,
    high_cut: Option<Biquad>,
    on: bool,
}

impl ChannelEq {
    fn configure(&mut self, fx: &ChannelFx) {
        self.on = fx.eq_enabled;
        self.bands[0].design(Shape::LowShelf, 120.0, 0.707, fx.low_db);
        self.bands[1].design(Shape::Peak, 2_500.0, 0.9, fx.mid_db);
        self.bands[2].design(Shape::HighShelf, 8_000.0, 0.707, fx.high_db);
        self.low_cut = (fx.low_cut_hz > LOW_CUT_OFF).then(|| {
            let mut f = self.low_cut.unwrap_or_default();
            f.design(Shape::HighPass, fx.low_cut_hz, 0.707, 0.0);
            f
        });
        self.high_cut = (fx.high_cut_hz < HIGH_CUT_OFF).then(|| {
            let mut f = self.high_cut.unwrap_or_default();
            f.design(Shape::LowPass, fx.high_cut_hz, 0.707, 0.0);
            f
        });
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        if !self.on {
            return x;
        }
        let mut y = x;
        for band in &mut self.bands {
            y = band.process(y);
        }
        if let Some(f) = &mut self.low_cut {
            y = f.process(y);
        }
        if let Some(f) = &mut self.high_cut {
            y = f.process(y);
        }
        y
    }
}

/// Die Busse eines Ausgangs.
pub struct BusChain {
    version: u64,
    params: BusParams,
    reverb: Reverb,
    echo: Echo,
    /// Soundboard, Musik, Live.
    eqs: [ChannelEq; 3],
}

impl Default for BusChain {
    fn default() -> Self {
        Self::new()
    }
}

/// Ein Kanal mit Klang-EQ im Ausgang.
#[derive(Debug, Clone, Copy)]
pub enum EqChannel {
    Soundboard = 0,
    Music = 1,
    Live = 2,
}

impl BusChain {
    pub fn new() -> Self {
        let mut chain = Self {
            version: u64::MAX,
            params: BusParams::default(),
            reverb: Reverb::new(),
            echo: Echo::new(),
            eqs: [ChannelEq::default(); 3],
        };
        chain.apply(BusParams::default());
        chain
    }

    fn apply(&mut self, params: BusParams) {
        self.reverb.configure(&params.reverb);
        self.echo.configure(&params.echo);
        let c = &params.channels;
        for (eq, fx) in self.eqs.iter_mut().zip([&c.soundboard, &c.music, &c.live]) {
            eq.configure(fx);
        }
        if params.reverb.enabled && !self.params.reverb.enabled {
            self.reverb.clear();
        }
        if params.echo.enabled && !self.params.echo.enabled {
            self.echo.clear();
        }
        self.params = params;
    }

    /// Neue Einstellungen übernehmen, ohne den Audio-Thread zu blockieren.
    pub fn sync(&mut self, shared: &BusShared) {
        let version = shared.version.load(Ordering::Acquire);
        if version == self.version {
            return;
        }
        let Some(params) = shared.params.try_lock().map(|p| *p) else {
            return;
        };
        self.version = version;
        if params != self.params {
            self.apply(params);
        }
    }

    /// (Hall, Echo) Send eines Kanals.
    pub fn sends(&self, id: ChannelId) -> (f32, f32) {
        let fx = self.params.channels.get(id);
        (fx.reverb_send, fx.echo_send)
    }

    #[inline]
    pub fn eq(&mut self, channel: EqChannel, x: f32) -> f32 {
        self.eqs[channel as usize].process(x)
    }

    /// Rückführung beider Busse für ein Sample.
    #[inline]
    pub fn returns(&mut self, reverb_in: f32, echo_in: f32) -> f32 {
        let mut out = 0.0;
        if self.params.reverb.enabled {
            out += self.reverb.wet(reverb_in) * self.params.reverb.mix * 3.0;
        }
        if self.params.echo.enabled {
            out += self.echo.wet(echo_in) * self.params.echo.mix;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eq_off_is_transparent() {
        let mut chain = BusChain::new();
        for i in 0..1000 {
            let x = (i as f32 * 0.01).sin();
            assert_eq!(chain.eq(EqChannel::Music, x), x);
        }
    }

    #[test]
    fn send_reaches_the_reverb() {
        let shared = BusShared::default();
        let mut params = BusParams::default();
        params.channels.soundboard.reverb_send = 1.0;
        shared.set(params);
        let mut chain = BusChain::new();
        chain.sync(&shared);
        let (send, _) = chain.sends(ChannelId::Soundboard);
        assert_eq!(send, 1.0);
        let mut tail = 0.0f32;
        for i in 0..48_000 {
            let x = if i == 0 { 1.0 } else { 0.0 };
            let y = chain.returns(x * send, 0.0);
            if i > 4_800 {
                tail += y * y;
            }
        }
        assert!(tail > 1e-6, "{tail}");
    }

    #[test]
    fn low_cut_removes_rumble() {
        let shared = BusShared::default();
        let mut params = BusParams::default();
        params.channels.live.eq_enabled = true;
        params.channels.live.low_cut_hz = 400.0;
        shared.set(params);
        let mut chain = BusChain::new();
        chain.sync(&shared);
        let mut energy = 0.0;
        for i in 0..48_000 {
            let x = (i as f32 * std::f32::consts::TAU * 50.0 / 48_000.0).sin();
            let y = chain.eq(EqChannel::Live, x);
            if i > 24_000 {
                energy += y * y;
            }
        }
        assert!(energy / 24_000.0 < 0.01, "{energy}");
    }
}
