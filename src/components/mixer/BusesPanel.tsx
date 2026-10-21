import { Church, Equalizer, Repeat } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { EqControls, EqGraph, useEqTarget } from "~/components/effects/EqEditor";
import { Crossfade, DeviceBar, DevicePage, KnobDeck, useSelected } from "~/components/effects/device";
import { LiveChart } from "~/components/voice/VoiceCharts";
import { EchoRows, ReverbRows } from "~/components/voice/VoiceDevices";
import { BUS_DEFAULTS, EQ_DEFAULTS } from "~/lib/defaults";
import type { ChannelId } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";

/* Effekt-Busse wie die Effekt-Seiten: oben Hall, Echo und die Klang-EQs der
   Kanäle zum Durchschalten, darunter das gewählte Gerät mit allen
   Einstellungen. Jeder Kanal schickt mit eigenem Send auf Hall und Echo. */

const CHANNELS: { id: ChannelId; name: () => string; color: string }[] = [
  { id: "mic", name: () => t("mixer.microphone"), color: "var(--ch-mic)" },
  { id: "soundboard", name: () => t("mixer.soundboard"), color: "var(--ch-soundboard)" },
  { id: "music", name: () => t("mixer.music"), color: "var(--ch-music)" },
  { id: "live", name: () => t("mixer.live"), color: "var(--ch-live)" },
];

/** Reihenfolge der Spektren in den Pegeln (lib.rs `bus_spectra`). */
const TONE_CHANNELS = ["soundboard", "music", "live"] as const;

const percent = (v: number) => `${Math.round(v * 100)} %`;

type BusId = "reverb" | "echo" | (typeof TONE_CHANNELS)[number];
const BUSES: BusId[] = ["reverb", "echo", ...TONE_CHANNELS];

/** Wie viel jeder Kanal auf den Bus schickt: ein Drehregler je Kanal in seiner Farbe. */
function Sends({ bus }: { bus: "reverbSend" | "echoSend" }) {
  const channels = useStore((s) => s.buses.channels);
  return (
    <KnobDeck
      knobs={CHANNELS.map((c) => ({
        label: c.name(),
        hint: c.id === "mic" ? t("devices.bus.sends") : undefined,
        color: c.color,
        value: channels[c.id][bus],
        min: 0,
        max: 1,
        step: 0.01,
        reset: 0,
        format: percent,
        onChange: (v: number) => actions.setChannelFx(c.id, { [bus]: v }),
      }))}
    />
  );
}

function ToneBus({ id }: { id: (typeof TONE_CHANNELS)[number] }) {
  const fx = useStore((s) => s.buses.channels[id]);
  const spectra = useStore((s) => (s.info ? s.meters?.effects.busSpectra?.[TONE_CHANNELS.indexOf(id)] : undefined));
  const [target, setTarget] = useEqTarget();
  const channel = CHANNELS.find((c) => c.id === id)!;
  const set = (patch: Partial<typeof fx>) => actions.setChannelFx(id, patch);
  return (
    <DevicePage
      title={`${channel.name()} · ${t("mixer.tone")}`}
      about={t("devices.tone.about")}
      accent={channel.color}
      graph={<EqGraph eq={fx} selected={target} onSelect={setTarget} onChange={set} spectrumIn={spectra?.[0]} spectrumOut={spectra?.[1]} />}
      enabled={fx.eqEnabled}
      onToggle={(eqEnabled) => set({ eqEnabled })}
      onReset={() => set({ ...EQ_DEFAULTS })}
    >
      <EqControls eq={fx} selected={target} onSelect={setTarget} onChange={set} />
    </DevicePage>
  );
}

function Bus({ id }: { id: BusId }) {
  const buses = useStore((s) => s.buses);
  if (id !== "reverb" && id !== "echo") return <ToneBus id={id} />;
  const p = buses[id];
  return (
    <DevicePage
      title={t(id === "reverb" ? "mixer.reverbBus" : "mixer.echoBus")}
      about={t(`devices.${id}.about`)}
      accent="var(--ch-fx)"
      graph={
        <LiveChart effect={id} enabled={p.enabled} source="bus" />
      }
      enabled={p.enabled}
      onToggle={(enabled) => actions.setBus(id, { enabled })}
      onReset={() => actions.setBus(id, { ...BUS_DEFAULTS[id], enabled: p.enabled })}
    >
      {id === "reverb" ? (
        <ReverbRows params={buses.reverb} mixLabel={t("mixer.returnLevel")} onChange={(patch) => actions.setBus("reverb", patch)} />
      ) : (
        <EchoRows params={buses.echo} mixLabel={t("mixer.returnLevel")} onChange={(patch) => actions.setBus("echo", patch)} />
      )}
      <Sends bus={id === "reverb" ? "reverbSend" : "echoSend"} />
    </DevicePage>
  );
}

export function BusesPanel() {
  const buses = useStore((s) => s.buses);
  const [open, select] = useSelected<BusId>("ode.bus-device", BUSES, "reverb");
  const tone = (id: (typeof TONE_CHANNELS)[number]) => {
    const channel = CHANNELS.find((c) => c.id === id)!;
    return { id, title: channel.name(), icon: (<Equalizer />) as ReactNode, accent: channel.color, enabled: buses.channels[id].eqEnabled };
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DeviceBar
        value={open}
        onChange={select}
        groups={[
          [
            { id: "reverb", title: t("mixer.reverbBus"), icon: <Church />, accent: "var(--ch-fx)", enabled: buses.reverb.enabled },
            { id: "echo", title: t("mixer.echoBus"), icon: <Repeat />, accent: "var(--ch-fx)", enabled: buses.echo.enabled },
          ],
          TONE_CHANNELS.map(tone),
        ]}
      />
      <Crossfade id={open} order={BUSES}>
        <Bus id={open} />
      </Crossfade>
    </div>
  );
}
