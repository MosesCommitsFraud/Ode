//! Engine-Thread: besitzt die Geräte-Streams und wird nur über Befehle
//! gesteuert. Mikrofon → Kanal-Fader → je ein Puffer pro Ausgang; dort
//! kommen Soundboard-Sounds dazu → Routing, Ausgangs-Fader, Limiter →
//! Kopfhörer (A) und Kabel (B).

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{
    BufferSize, Device, FromSample, Host, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
    SupportedStreamConfig,
};
use crossbeam_channel::{Receiver, Sender, bounded, unbounded};
use parking_lot::Mutex;
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use serde::{Deserialize, Serialize};

use super::deck::{Deck, DeckCommand, DeckStatus};
use super::dsp::{Ducker, Limiter, SmoothedGain, peak};
use super::effects::EffectChain;
use super::mixer::{ChannelId, Mixer, OutputId, player_gain};
use super::resample::{PullResampler, PushResampler};
use super::sampler::{PlayingSound, Sampler, SamplerCommand};
use super::{BLOCK_FRAMES, ENGINE_RATE, devices};

/// Größter Callback, für den Puffer vorab angelegt werden.
const MAX_CALLBACK_FRAMES: usize = 16_384;
/// Kapazität der Puffer zwischen Eingang und Ausgängen: 1 s.
const RING_FRAMES: usize = ENGINE_RATE as usize;
/// Vorlauf für Live-Quellen: 20 ms gleichen die getrennten Takte aus.
const LIVE_TARGET: usize = ENGINE_RATE as usize / 50;
/// Glättung für Routing und Kanal-Fader, etwa 10 ms Zeitkonstante.
const SMOOTHING: f32 = 1.0 / 480.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub input_id: String,
    /// Kopfhörer (Ausgang A), optional.
    pub monitor_id: Option<String>,
    /// Virtuelles Kabel (Ausgang B), optional.
    pub cable_id: Option<String>,
    /// Zielfüllstand der Zwischenpuffer in Millisekunden.
    pub buffer_ms: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub input: StreamInfo,
    pub monitor: Option<StreamInfo>,
    pub cable: Option<StreamInfo>,
}

enum Command {
    Start(EngineConfig, Sender<Result<EngineInfo, String>>),
    Stop(Sender<()>),
}

struct Running {
    _streams: Vec<Stream>,
    info: EngineInfo,
    samplers: Vec<Sender<SamplerCommand>>,
    decks: Vec<Sender<DeckCommand>>,
}

pub struct Engine {
    commands: Sender<Command>,
    pub mixer: Arc<Mixer>,
    pub errors: Arc<Mutex<Vec<String>>>,
    info: Arc<Mutex<Option<EngineInfo>>>,
    samplers: Arc<Mutex<Vec<Sender<SamplerCommand>>>>,
    /// Laufende Sounds für die Oberfläche.
    pub playing: Arc<Mutex<Vec<PlayingSound>>>,
    decks: Arc<Mutex<Vec<Sender<DeckCommand>>>>,
    /// Stand des Musik-Decks.
    pub deck_status: Arc<Mutex<DeckStatus>>,
    /// Eingänge der Live-Puffer je Ausgang; die Live-Quelle schreibt hinein.
    pub live_producers: Arc<Mutex<Vec<HeapProd<f32>>>>,
}

impl Engine {
    pub fn spawn() -> Self {
        let (commands, receiver) = unbounded();
        let mixer = Arc::new(Mixer::default());
        let errors = Arc::new(Mutex::new(Vec::new()));
        let info = Arc::new(Mutex::new(None));
        let samplers = Arc::new(Mutex::new(Vec::new()));
        let playing = Arc::new(Mutex::new(Vec::new()));
        let decks = Arc::new(Mutex::new(Vec::new()));
        let deck_status = Arc::new(Mutex::new(DeckStatus::default()));
        let live_producers = Arc::new(Mutex::new(Vec::new()));

        let shared = Shared {
            mixer: mixer.clone(),
            errors: errors.clone(),
            info: info.clone(),
            samplers: samplers.clone(),
            playing: playing.clone(),
            decks: decks.clone(),
            deck_status: deck_status.clone(),
            live_producers: live_producers.clone(),
        };
        thread::Builder::new()
            .name("ode-engine".into())
            .spawn(move || run(receiver, shared))
            .expect("Engine-Thread konnte nicht starten");

        Self {
            commands,
            mixer,
            errors,
            info,
            samplers,
            playing,
            decks,
            deck_status,
            live_producers,
        }
    }

    /// Schickt einen Befehl an die Musik-Decks aller Ausgänge.
    pub fn deck(&self, command: DeckCommand) -> Result<(), String> {
        let decks = self.decks.lock();
        if decks.is_empty() {
            return Err("Engine ist nicht gestartet".into());
        }
        for deck in decks.iter() {
            let _ = deck.send(command.clone());
        }
        Ok(())
    }

    /// Schickt einen Befehl an die Sampler aller Ausgänge.
    pub fn sampler(&self, command: SamplerCommand) -> Result<(), String> {
        let samplers = self.samplers.lock();
        if samplers.is_empty() {
            return Err("Engine ist nicht gestartet".into());
        }
        for sampler in samplers.iter() {
            let _ = sampler.send(command.clone());
        }
        Ok(())
    }

    pub fn start(&self, config: EngineConfig) -> Result<EngineInfo, String> {
        let (reply, response) = bounded(1);
        self.commands
            .send(Command::Start(config, reply))
            .map_err(|_| "Engine läuft nicht".to_string())?;
        response
            .recv()
            .map_err(|_| "Engine antwortet nicht".to_string())?
    }

    pub fn stop(&self) {
        let (reply, response) = bounded(1);
        if self.commands.send(Command::Stop(reply)).is_ok() {
            let _ = response.recv();
        }
    }

    pub fn info(&self) -> Option<EngineInfo> {
        self.info.lock().clone()
    }
}

struct Shared {
    mixer: Arc<Mixer>,
    errors: Arc<Mutex<Vec<String>>>,
    info: Arc<Mutex<Option<EngineInfo>>>,
    samplers: Arc<Mutex<Vec<Sender<SamplerCommand>>>>,
    playing: Arc<Mutex<Vec<PlayingSound>>>,
    decks: Arc<Mutex<Vec<Sender<DeckCommand>>>>,
    deck_status: Arc<Mutex<DeckStatus>>,
    live_producers: Arc<Mutex<Vec<HeapProd<f32>>>>,
}

impl Shared {
    fn clear(&self) {
        *self.info.lock() = None;
        self.samplers.lock().clear();
        self.playing.lock().clear();
        self.decks.lock().clear();
        *self.deck_status.lock() = DeckStatus::default();
        self.live_producers.lock().clear();
    }
}

fn run(commands: Receiver<Command>, shared: Shared) {
    let host = cpal::default_host();
    let mut running: Option<Running> = None;

    for command in commands {
        match command {
            Command::Start(config, reply) => {
                // Alte Streams zuerst schließen, damit Geräte frei werden.
                running = None;
                shared.clear();
                let result = start(&host, &config, &shared).map_err(|e| e.to_string());
                let response = match result {
                    Ok(state) => {
                        let engine_info = state.info.clone();
                        *shared.info.lock() = Some(engine_info.clone());
                        *shared.samplers.lock() = state.samplers.clone();
                        *shared.decks.lock() = state.decks.clone();
                        running = Some(state);
                        Ok(engine_info)
                    }
                    Err(e) => Err(e),
                };
                let _ = reply.send(response);
            }
            Command::Stop(reply) => {
                running = None;
                shared.clear();
                let _ = reply.send(());
            }
        }
    }
    drop(running);
}

fn start(host: &Host, config: &EngineConfig, shared: &Shared) -> anyhow::Result<Running> {
    let mixer = &shared.mixer;
    let errors = &shared.errors;
    errors.lock().clear();
    mixer.out_a.reset_stats();
    mixer.out_b.reset_stats();

    let target_frames =
        ((config.buffer_ms.clamp(2.0, 200.0) / 1000.0) * ENGINE_RATE as f32) as usize;

    let mut producers = Vec::new();
    let mut streams = Vec::new();
    let mut samplers = Vec::new();
    let mut decks = Vec::new();
    let mut live_producers = Vec::new();
    let mut monitor = None;
    let mut cable = None;

    for (output, id) in [
        (OutputId::A, config.monitor_id.as_deref()),
        (OutputId::B, config.cable_id.as_deref()),
    ] {
        let Some(id) = id else { continue };
        let device = devices::find(host, id)?;
        let (producer, consumer) = HeapRb::<f32>::new(RING_FRAMES).split();
        // Den Fortschritt meldet das Kabel, ohne Kabel der Kopfhörer.
        let reports = output == OutputId::B || config.cable_id.is_none();
        let (sampler_tx, sampler_rx) = unbounded();
        let sampler = Sampler::new(sampler_rx, reports.then(|| shared.playing.clone()));
        let (deck_tx, deck_rx) = unbounded();
        let deck = Deck::new(deck_rx, reports.then(|| shared.deck_status.clone()));
        let (live_producer, live_consumer) = HeapRb::<f32>::new(RING_FRAMES).split();
        live_producers.push(live_producer);
        let (stream, stream_info) = build_output(
            &device,
            mixer.clone(),
            errors.clone(),
            output,
            consumer,
            (sampler, deck, live_consumer),
            target_frames,
        )?;
        samplers.push(sampler_tx);
        decks.push(deck_tx);
        producers.push((output, producer));
        streams.push(stream);
        match output {
            OutputId::A => monitor = Some(stream_info),
            OutputId::B => cable = Some(stream_info),
        }
    }

    *shared.live_producers.lock() = live_producers;

    let input_device = devices::find(host, &config.input_id)?;
    let (input_stream, input) =
        build_input(&input_device, mixer.clone(), errors.clone(), producers)?;
    streams.push(input_stream);

    // Mikrofon zuerst starten, damit die Ausgänge nicht leer anlaufen.
    for stream in streams.iter().rev() {
        stream.play()?;
    }

    Ok(Running {
        _streams: streams,
        info: EngineInfo {
            input,
            monitor,
            cable,
        },
        samplers,
        decks,
    })
}

/// Bevorzugt 48 kHz im Standardformat des Geräts, sonst dessen Standard.
fn pick_config(
    default: SupportedStreamConfig,
    ranges: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
) -> SupportedStreamConfig {
    if default.sample_rate() == ENGINE_RATE {
        return default;
    }
    let mut ranges = ranges.collect::<Vec<_>>();
    ranges.sort_by_key(|r| r.sample_format() != SampleFormat::F32);
    ranges
        .into_iter()
        .filter(|r| r.channels() == default.channels())
        .find_map(|r| r.try_with_sample_rate(ENGINE_RATE))
        .unwrap_or(default)
}

fn stream_info(device: &Device, config: &SupportedStreamConfig) -> StreamInfo {
    StreamInfo {
        device_name: devices::name_of(device),
        sample_rate: config.sample_rate(),
        channels: config.channels(),
        sample_format: config.sample_format().to_string(),
    }
}

fn error_callback(errors: Arc<Mutex<Vec<String>>>, label: &'static str) -> impl FnMut(cpal::Error) {
    move |err| {
        let mut errors = errors.lock();
        if errors.len() < 32 {
            errors.push(format!("{label}: {err}"));
        }
    }
}

/// Versucht feste 10-ms-Blöcke und fällt auf die Gerätevorgabe zurück.
fn build_with_buffer<F>(base: StreamConfig, mut build: F) -> Result<Stream, cpal::Error>
where
    F: FnMut(StreamConfig) -> Result<Stream, cpal::Error>,
{
    let block = (base.sample_rate as usize * BLOCK_FRAMES / ENGINE_RATE as usize) as u32;
    let fixed = StreamConfig {
        buffer_size: BufferSize::Fixed(block),
        ..base
    };
    build(fixed).or_else(|_| {
        build(StreamConfig {
            buffer_size: BufferSize::Default,
            ..base
        })
    })
}

macro_rules! dispatch_format {
    ($format:expr, $build:ident, $($arg:expr),*) => {
        match $format {
            SampleFormat::F32 => $build::<f32>($($arg),*),
            SampleFormat::I16 => $build::<i16>($($arg),*),
            SampleFormat::I32 => $build::<i32>($($arg),*),
            SampleFormat::U16 => $build::<u16>($($arg),*),
            other => anyhow::bail!("Nicht unterstütztes Sample-Format: {other}"),
        }
    };
}

// ---------------------------------------------------------------- Eingang

struct InputProcessor {
    mixer: Arc<Mixer>,
    producers: Vec<(OutputId, HeapProd<f32>)>,
    resampler: PushResampler,
    channels: usize,
    mono: Vec<f32>,
    engine: Vec<f32>,
    effects: EffectChain,
    gain: SmoothedGain,
}

impl InputProcessor {
    fn process<T>(&mut self, data: &[T])
    where
        T: Sample,
        f32: FromSample<T>,
    {
        let started = std::time::Instant::now();
        let frames = data.len() / self.channels;
        self.mixer
            .input_callback_frames
            .store(frames as u32, Ordering::Relaxed);

        // Auf Mono mischen.
        self.mono.clear();
        let scale = 1.0 / self.channels as f32;
        for frame in data.chunks_exact(self.channels) {
            let sum: f32 = frame.iter().map(|s| s.to_sample::<f32>()).sum();
            self.mono.push(sum * scale);
        }

        // Auf Engine-Rate bringen.
        self.engine.clear();
        if self.resampler.is_passthrough() {
            self.engine.extend_from_slice(&self.mono);
        } else {
            let engine = &mut self.engine;
            self.resampler.process(&self.mono, |s| engine.push(s));
        }

        // Effektkette vor dem Kanal-Fader.
        self.effects.process(&mut self.engine, &self.mixer.effects);
        let mic = self.mixer.channel(ChannelId::Mic);
        self.gain.apply(&mut self.engine, mic.gain());
        mic.meter.fetch_max(peak(&self.engine));

        for (output, producer) in &mut self.producers {
            let pushed = producer.push_slice(&self.engine);
            if pushed < self.engine.len() {
                self.mixer
                    .output(*output)
                    .overruns
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
        self.mixer
            .input_process_us
            .fetch_max(started.elapsed().as_micros() as u32, Ordering::Relaxed);
    }
}

fn build_input(
    device: &Device,
    mixer: Arc<Mixer>,
    errors: Arc<Mutex<Vec<String>>>,
    producers: Vec<(OutputId, HeapProd<f32>)>,
) -> anyhow::Result<(Stream, StreamInfo)> {
    let supported = pick_config(
        device.default_input_config()?,
        device.supported_input_configs()?,
    );
    let info = stream_info(device, &supported);
    let rate = supported.sample_rate();
    mixer.input_rate.store(rate, Ordering::Relaxed);

    let processor = InputProcessor {
        mixer,
        producers,
        resampler: PushResampler::new(rate, ENGINE_RATE),
        channels: supported.channels() as usize,
        mono: Vec::with_capacity(MAX_CALLBACK_FRAMES),
        engine: Vec::with_capacity(MAX_CALLBACK_FRAMES * 2),
        effects: EffectChain::new(),
        gain: SmoothedGain::new(0.0),
    };

    fn build<T>(
        device: &Device,
        config: StreamConfig,
        processor: InputProcessor,
        errors: Arc<Mutex<Vec<String>>>,
    ) -> anyhow::Result<Stream>
    where
        T: SizedSample + Send + 'static,
        f32: FromSample<T>,
    {
        let processor = Arc::new(Mutex::new(processor));
        let stream = build_with_buffer(config, |config| {
            let processor = processor.clone();
            device.build_input_stream::<T, _, _>(
                config,
                move |data, _| processor.lock().process(data),
                error_callback(errors.clone(), "Mikrofon"),
                None,
            )
        })?;
        Ok(stream)
    }

    let config = supported.config();
    let stream = dispatch_format!(
        supported.sample_format(),
        build,
        device,
        config,
        processor,
        errors
    )?;
    Ok((stream, info))
}

// ---------------------------------------------------------------- Ausgänge

struct OutputProcessor {
    mixer: Arc<Mixer>,
    output: OutputId,
    consumer: HeapCons<f32>,
    sampler: Sampler,
    deck: Deck,
    /// Ton der Live-Quelle (Programm-Mitschnitt), Engine-Rate, mono.
    live: HeapCons<f32>,
    /// Live erst ausgeben, wenn genug Vorlauf da ist.
    live_primed: bool,
    resampler: PullResampler,
    channels: usize,
    target_frames: usize,
    /// Weich nachgeführte Kanal-Pegel für dieses Ziel (pro Sample).
    mic_send: f32,
    soundboard_send: f32,
    music_send: f32,
    live_send: f32,
    /// Geglättete Player-Lautstärke.
    player: f32,
    ducker: Ducker,
    /// Erst ausgeben, wenn der Puffer einmal den Zielwert erreicht hat.
    primed: bool,
    mono: Vec<f32>,
    gain: SmoothedGain,
    limiter: Limiter,
}

impl OutputProcessor {
    fn process<T>(&mut self, data: &mut [T])
    where
        T: Sample + FromSample<f32>,
    {
        let frames = data.len() / self.channels;
        let out = self.mixer.output(self.output);
        out.callback_frames.store(frames as u32, Ordering::Relaxed);

        // Bis das Mikrofon den Puffer gefüllt hat, Stille ohne Aussetzer-Zählung.
        let buffered = self.consumer.occupied_len();
        if !self.primed {
            if buffered < self.target_frames {
                data.fill(T::EQUILIBRIUM);
                return;
            }
            self.primed = true;
        }

        // Drift-Ausgleich: läuft der Puffer voll, auf den Zielwert kürzen.
        let high_water = self.target_frames + 2 * BLOCK_FRAMES + frames;
        if buffered > high_water {
            self.consumer.skip(buffered - self.target_frames);
            out.overruns.fetch_add(1, Ordering::Relaxed);
        }
        out.buffered_frames
            .store(self.consumer.occupied_len() as u32, Ordering::Relaxed);

        self.sampler.poll();
        self.deck.poll();

        // Kanäle in Engine-Rate mischen; Routing und Fader gleiten weich.
        let mic_target = self.mixer.channel(ChannelId::Mic).send(self.output);
        let soundboard = self.mixer.channel(ChannelId::Soundboard);
        let soundboard_fader = soundboard.gain();
        let soundboard_target = soundboard_fader * soundboard.send(self.output);
        let mut soundboard_peak = 0.0f32;
        let music = self.mixer.channel(ChannelId::Music);
        let music_fader = music.gain();
        let music_target = music_fader * music.send(self.output);
        let live_channel = self.mixer.channel(ChannelId::Live);
        let live_fader = live_channel.gain();
        let live_target = live_fader * live_channel.send(self.output);
        let mut live_peak = 0.0f32;
        let player_target = player_gain(self.mixer.player_volume.load());
        let mut music_peak = 0.0f32;
        let ducking = &self.mixer.ducking;
        let (duck_on, duck_threshold, duck_reduction) =
            (ducking.enabled(), ducking.threshold(), ducking.reduction());
        let ducker = &mut self.ducker;
        let mut duck_min = 1.0f32;

        self.mono.resize(frames, 0.0);
        let mut starved = false;
        let consumer = &mut self.consumer;
        let sampler = &mut self.sampler;
        let deck = &mut self.deck;

        // Live-Quelle: Vorlauf abwarten, bei Überlauf auf den Zielwert kürzen.
        let live_buffered = self.live.occupied_len();
        if !self.live_primed && live_buffered >= LIVE_TARGET {
            self.live_primed = true;
        }
        if live_buffered > LIVE_TARGET * 3 + frames {
            self.live.skip(live_buffered - LIVE_TARGET);
        }
        let live = &mut self.live;
        let live_primed = &mut self.live_primed;
        let mic_send = &mut self.mic_send;
        let soundboard_send = &mut self.soundboard_send;
        let music_send = &mut self.music_send;
        let live_send = &mut self.live_send;
        let player = &mut self.player;
        let mut next = || {
            let mic = consumer.try_pop().unwrap_or_else(|| {
                starved = true;
                0.0
            });
            *mic_send += (mic_target - *mic_send) * SMOOTHING;
            *soundboard_send += (soundboard_target - *soundboard_send) * SMOOTHING;
            *music_send += (music_target - *music_send) * SMOOTHING;
            *live_send += (live_target - *live_send) * SMOOTHING;
            *player += (player_target - *player) * SMOOTHING;
            // Ducking hört auf das Mikrofon nach dem Fader, vor dem Routing.
            let duck = ducker.next(mic, duck_threshold, duck_reduction, duck_on);
            duck_min = duck_min.min(duck);
            let mut sum = mic * *mic_send;
            if !sampler.is_idle() {
                let sound = sampler.next_sample() * duck;
                soundboard_peak = soundboard_peak.max((sound * soundboard_fader).abs());
                sum += sound * *soundboard_send;
            }
            if !deck.is_idle() {
                let song = deck.next_sample() * *player * duck;
                music_peak = music_peak.max((song * music_fader).abs());
                sum += song * *music_send;
            }
            // Live-Quelle: eigener Kanal mit Fader, Routing und Ducking.
            if *live_primed {
                match live.try_pop() {
                    Some(s) => {
                        let s = s * duck;
                        live_peak = live_peak.max((s * live_fader).abs());
                        sum += s * *live_send;
                    }
                    // Quelle beendet oder Lücke: neu vorlaufen lassen.
                    None => *live_primed = false,
                }
            }
            sum
        };
        if self.resampler.is_passthrough() {
            self.mono.iter_mut().for_each(|s| *s = next());
        } else {
            self.resampler.process(&mut self.mono, next);
        }
        if starved {
            out.underruns.fetch_add(1, Ordering::Relaxed);
        }
        soundboard.meter.fetch_max(soundboard_peak);
        music.meter.fetch_max(music_peak);
        live_channel.meter.fetch_max(live_peak);
        self.sampler.report();
        self.deck.report();
        if self.output == OutputId::B || !self.mixer.out_b.is_active() {
            let db = if duck_min < 1.0 {
                20.0 * duck_min.max(1e-6).log10()
            } else {
                0.0
            };
            ducking.reduction_db.store(db);
        }

        self.gain.apply(&mut self.mono, out.gain());

        if out.limiter_enabled() {
            self.limiter.process(&mut self.mono);
            out.gain_reduction_db
                .store(self.limiter.gain_reduction_db());
        } else {
            self.mono.iter_mut().for_each(|s| *s = s.clamp(-1.0, 1.0));
        }
        out.meter.fetch_max(peak(&self.mono));

        for (frame, &s) in data.chunks_exact_mut(self.channels).zip(&self.mono) {
            let sample = T::from_sample(s);
            frame.iter_mut().for_each(|d| *d = sample);
        }
    }
}

fn build_output(
    device: &Device,
    mixer: Arc<Mixer>,
    errors: Arc<Mutex<Vec<String>>>,
    output: OutputId,
    consumer: HeapCons<f32>,
    (sampler, deck, live): (Sampler, Deck, HeapCons<f32>),
    target_frames: usize,
) -> anyhow::Result<(Stream, StreamInfo)> {
    let supported = pick_config(
        device.default_output_config()?,
        device.supported_output_configs()?,
    );
    let info = stream_info(device, &supported);
    let rate = supported.sample_rate();
    mixer
        .output(output)
        .device_rate
        .store(rate, Ordering::Relaxed);

    let processor = OutputProcessor {
        mixer,
        output,
        consumer,
        sampler,
        deck,
        live,
        live_primed: false,
        resampler: PullResampler::new(ENGINE_RATE, rate),
        channels: supported.channels() as usize,
        target_frames,
        mic_send: 0.0,
        soundboard_send: 0.0,
        music_send: 0.0,
        live_send: 0.0,
        player: 0.0,
        ducker: Ducker::new(ENGINE_RATE),
        primed: false,
        mono: Vec::with_capacity(MAX_CALLBACK_FRAMES),
        gain: SmoothedGain::new(0.0),
        limiter: Limiter::new(-1.0, 80.0, rate),
    };

    fn build<T>(
        device: &Device,
        config: StreamConfig,
        processor: OutputProcessor,
        errors: Arc<Mutex<Vec<String>>>,
        label: &'static str,
    ) -> anyhow::Result<Stream>
    where
        T: SizedSample + FromSample<f32> + Send + 'static,
    {
        let processor = Arc::new(Mutex::new(processor));
        let stream = build_with_buffer(config, |config| {
            let processor = processor.clone();
            device.build_output_stream::<T, _, _>(
                config,
                move |data, _| processor.lock().process(data),
                error_callback(errors.clone(), label),
                None,
            )
        })?;
        Ok(stream)
    }

    let label = match output {
        OutputId::A => "Kopfhörer",
        OutputId::B => "Kabel",
    };
    let config = supported.config();
    let stream = dispatch_format!(
        supported.sample_format(),
        build,
        device,
        config,
        processor,
        errors,
        label
    )?;
    Ok((stream, info))
}
