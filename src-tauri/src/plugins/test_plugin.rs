//! Ein winziges Gain-Plugin mit einem Parameter, gebaut mit clack-plugin.
//! Der Hilfsprozess lädt es unter dem Pfad [`PATH`] ohne Datei; Tests prüfen
//! damit den ganzen Weg (Laden, Audio, Parameter, Absturz). In der Suche
//! taucht es nicht auf.

use std::ffi::CStr;
use std::sync::atomic::{AtomicU64, Ordering};

use clack_extensions::audio_ports::{
    AudioPortFlags, AudioPortInfo, AudioPortInfoWriter, AudioPortType, PluginAudioPorts,
    PluginAudioPortsImpl,
};
use clack_extensions::params::{
    ParamDisplayWriter, ParamInfo, ParamInfoFlags, ParamInfoWriter, PluginAudioProcessorParams,
    PluginMainThreadParams, PluginParams,
};
use clack_host::entry::PluginEntry;
use clack_plugin::events::event_types::ParamValueEvent;
use clack_plugin::prelude as p;
use clack_plugin::prelude::{
    Audio, ChannelPair, ClapId, Events, HostAudioProcessorHandle, HostMainThreadHandle,
    HostSharedHandle, InputEvents, OutputEvents, Plugin, PluginAudioConfiguration,
    PluginAudioProcessor as PluginProcessor, PluginDescriptor, PluginError, PluginExtensions,
    Process, ProcessStatus, SinglePluginEntry,
};

/// Pfad, unter dem der Hilfsprozess das Test-Plugin lädt.
pub const PATH: &str = "ode:test-gain";
pub const ID: &str = "app.ode.test-gain";

pub fn entry() -> Result<PluginEntry, String> {
    PluginEntry::load_from_clack::<SinglePluginEntry<TestGain>>(c"ode:test-gain")
        .map_err(|e| format!("{e:?}"))
}

/// ID des einzigen Parameters.
pub const GAIN: u32 = 1;

pub struct TestGain;

#[derive(Default)]
pub struct GainShared {
    /// f64-Bits des aktuellen Gains.
    gain: AtomicU64,
}

impl GainShared {
    fn get(&self) -> f64 {
        f64::from_bits(self.gain.load(Ordering::Relaxed))
    }
    fn set(&self, v: f64) {
        self.gain.store(v.to_bits(), Ordering::Relaxed);
    }
}

impl p::PluginShared<'_> for GainShared {}

pub struct GainMain<'a> {
    shared: &'a GainShared,
}

impl<'a> p::PluginMainThread<'a, GainShared> for GainMain<'a> {}

pub struct GainProcessor<'a> {
    shared: &'a GainShared,
}

impl Plugin for TestGain {
    type AudioProcessor<'a> = GainProcessor<'a>;
    type Shared<'a> = GainShared;
    type MainThread<'a> = GainMain<'a>;

    fn declare_extensions(builder: &mut PluginExtensions<Self>, _shared: Option<&GainShared>) {
        builder
            .register::<PluginAudioPorts>()
            .register::<PluginParams>();
    }
}

impl p::DefaultPluginFactory for TestGain {
    fn get_descriptor() -> PluginDescriptor {
        PluginDescriptor::new("app.ode.test-gain", "Test Gain")
    }

    fn new_shared(_host: HostSharedHandle<'_>) -> Result<GainShared, PluginError> {
        let shared = GainShared::default();
        shared.set(1.0);
        Ok(shared)
    }

    fn new_main_thread<'a>(
        _host: HostMainThreadHandle<'a>,
        shared: &'a GainShared,
    ) -> Result<GainMain<'a>, PluginError> {
        Ok(GainMain { shared })
    }
}

impl<'a> PluginProcessor<'a, GainShared, GainMain<'a>> for GainProcessor<'a> {
    fn activate(
        _host: HostAudioProcessorHandle<'a>,
        _main: &GainMain<'a>,
        shared: &'a GainShared,
        _config: PluginAudioConfiguration,
    ) -> Result<Self, PluginError> {
        Ok(Self { shared })
    }

    fn process(
        &mut self,
        _process: Process,
        mut audio: Audio,
        events: Events,
    ) -> Result<ProcessStatus, PluginError> {
        for event in events.input {
            if let Some(e) = event.as_event::<ParamValueEvent>()
                && e.param_id().map(|i| i.get()) == Some(GAIN)
            {
                self.shared.set(e.value());
            }
        }
        let gain = self.shared.get() as f32;
        for mut port in &mut audio {
            let Some(pairs) = port.channels()?.into_f32() else {
                continue;
            };
            for pair in pairs {
                match pair {
                    ChannelPair::InputOutput(i, o) => {
                        for (i, o) in i.iter().zip(o) {
                            *o = i * gain;
                        }
                    }
                    ChannelPair::InPlace(b) => b.iter_mut().for_each(|s| *s *= gain),
                    ChannelPair::OutputOnly(b) => b.fill(0.0),
                    ChannelPair::InputOnly(_) => {}
                }
            }
        }
        Ok(ProcessStatus::Continue)
    }
}

impl PluginAudioPortsImpl for GainMain<'_> {
    fn count(&self, _is_input: bool) -> u32 {
        1
    }

    fn get(&self, index: u32, _is_input: bool, writer: &mut AudioPortInfoWriter) {
        if index == 0 {
            writer.set(&AudioPortInfo {
                id: ClapId::new(0),
                name: b"main",
                channel_count: 1,
                flags: AudioPortFlags::IS_MAIN,
                port_type: Some(AudioPortType::MONO),
                in_place_pair: None,
            });
        }
    }
}

impl PluginMainThreadParams for GainMain<'_> {
    fn count(&self) -> u32 {
        1
    }

    fn get_info(&self, index: u32, info: &mut ParamInfoWriter) {
        if index == 0 {
            info.set(&ParamInfo {
                id: ClapId::new(GAIN),
                flags: ParamInfoFlags::IS_AUTOMATABLE,
                cookie: Default::default(),
                name: b"Gain",
                module: b"",
                min_value: 0.0,
                max_value: 2.0,
                default_value: 1.0,
            });
        }
    }

    fn get_value(&self, id: ClapId) -> Option<f64> {
        (id.get() == GAIN).then(|| self.shared.get())
    }

    fn value_to_text(
        &self,
        _id: ClapId,
        value: f64,
        writer: &mut ParamDisplayWriter,
    ) -> std::fmt::Result {
        use std::fmt::Write;
        write!(writer, "{value:.2}x")
    }

    fn text_to_value(&self, _id: ClapId, _text: &CStr) -> Option<f64> {
        None
    }

    fn flush(&self, _input: &InputEvents, _output: &mut OutputEvents) {}
}

impl PluginAudioProcessorParams for GainProcessor<'_> {
    fn flush(&mut self, _input: &InputEvents, _output: &mut OutputEvents) {}
}
