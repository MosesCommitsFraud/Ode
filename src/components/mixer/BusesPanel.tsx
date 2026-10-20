import { Church, Equalizer, Repeat } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Crossfade, DeviceBar, DevicePage, ParamRow, Slider, useSelected } from "~/components/effects/device";
import { parseNumber } from "~/components/ui/knob";
import { EchoRows, ReverbRows } from "~/components/voice/VoiceDevices";
import { BUS_DEFAULTS, CHANNEL_FX_DEFAULTS } from "~/lib/defaults";
import type { ChannelId } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { formatDb } from "~/lib/utils";

/* Effekt-Busse wie die Effekt-Seiten: oben Hall, Echo und die Klang-EQs der
   Kanäle zum Durchschalten, darunter das gewählte Gerät mit allen
   Einstellungen. Jeder Kanal schickt mit eigenem Send auf Hall und Echo. */

const CHANNELS: { id: ChannelId; name: () => string; color: string }[] = [
  { id: "mic", name: () => t("mixer.microphone"), color: "var(--ch-mic)" },
  { id: "soundboard", name: () => t("mixer.soundboard"), color: "var(--ch-soundboard)" },
  { id: "music", name: () => t("mixer.music"), color: "var(--ch-music)" },
  { id: "live", name: () => t("mixer.live"), color: "var(--ch-live)" },
];

const percent = (v: number) => `${Math.round(v * 100)} %`;
const parseLogHz = (text: string) => {
  const value = parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
  return value && value > 0 ? Math.log2(value) : null;
};

type BusId = "reverb" | "echo" | "soundboard" | "music" | "live";
const BUSES: BusId[] = ["reverb", "echo", "soundboard", "music", "live"];

/** Wie viel jeder Kanal auf den Bus schickt, je eine Zeile in Kanalfarbe. */
function Sends({ bus }: { bus: "reverbSend" | "echoSend" }) {
  const channels = useStore((s) => s.buses.channels);
  return (
    <>
      {CHANNELS.map((c) => (
        <ParamRow key={c.id} label={`${t("mixer.sendTo")} · ${c.name()}`} hint={c.id === "mic" ? t("devices.bus.sends") : undefined}>
          <div style={{ "--ch-mic": c.color } as React.CSSProperties}>
            <Slider
              label={c.name()}
              value={channels[c.id][bus]}
              min={0}
              max={1}
              step={0.01}
              reset={0}
              format={percent}
              onChange={(v) => actions.setChannelFx(c.id, { [bus]: v })}
            />
          </div>
        </ParamRow>
      ))}
    </>
  );
}

function Bus({ id }: { id: BusId }) {
  const buses = useStore((s) => s.buses);
  if (id === "reverb" || id === "echo") {
    const p = buses[id];
    return (
      <DevicePage
        icon={id === "reverb" ? <Church /> : <Repeat />}
        title={t(id === "reverb" ? "mixer.reverbBus" : "mixer.echoBus")}
        about={t(`devices.${id}.about`)}
        accent="var(--ch-out)"
        columns={2}
        enabled={p.enabled}
        onToggle={(enabled) => actions.setBus(id, { enabled })}
        onReset={() => actions.setBus(id, { ...BUS_DEFAULTS[id], enabled: p.enabled })}
      >
        <div className="flex min-w-0 flex-col">
          {id === "reverb" ? (
            <ReverbRows params={buses.reverb} mixLabel={t("mixer.returnLevel")} onChange={(patch) => actions.setBus("reverb", patch)} />
          ) : (
            <EchoRows params={buses.echo} mixLabel={t("mixer.returnLevel")} onChange={(patch) => actions.setBus("echo", patch)} />
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <Sends bus={id === "reverb" ? "reverbSend" : "echoSend"} />
        </div>
      </DevicePage>
    );
  }

  const channel = CHANNELS.find((c) => c.id === id)!;
  const fx = buses.channels[id];
  const set = (patch: Partial<typeof fx>) => actions.setChannelFx(id, patch);
  return (
    <DevicePage
      icon={<Equalizer />}
      title={`${channel.name()} · ${t("mixer.tone")}`}
      about={t("devices.tone.about")}
      accent={channel.color}
      columns={2}
      enabled={fx.eqEnabled}
      onToggle={(eqEnabled) => set({ eqEnabled })}
      onReset={() => {
        const { lowDb, midDb, highDb, lowCutHz, highCutHz } = CHANNEL_FX_DEFAULTS;
        set({ lowDb, midDb, highDb, lowCutHz, highCutHz });
      }}
    >
      <div className="flex min-w-0 flex-col">
        {(
          [
            ["lowDb", "effects.bass", "devices.eq.low"],
            ["midDb", "effects.presence", "devices.eq.mid"],
            ["highDb", "effects.treble", "devices.eq.high"],
          ] as const
        ).map(([key, label, hint]) => (
          <ParamRow key={key} label={t(label)} hint={t(hint)}>
            <Slider
              label={t(label)}
              value={fx[key]}
              min={-12}
              max={12}
              step={0.5}
              reset={0}
              bipolar
              format={(v) => `${formatDb(v)} dB`}
              marks={[
                [-12, "−12"],
                [0, "0"],
                [12, "+12"],
              ]}
              onChange={(v) => set({ [key]: v })}
            />
          </ParamRow>
        ))}
      </div>
      <div className="flex min-w-0 flex-col">
        <ParamRow label={t("mixer.lowCut")} hint={t("devices.tone.lowCut")}>
          <Slider
            label={t("mixer.lowCut")}
            value={Math.log2(fx.lowCutHz)}
            min={Math.log2(20)}
            max={Math.log2(1000)}
            step={0.01}
            reset={Math.log2(20)}
            parse={parseLogHz}
            format={(v) => (Math.pow(2, v) <= 20.5 ? t("mixer.cutOff") : `${Math.round(Math.pow(2, v))} Hz`)}
            onChange={(v) => set({ lowCutHz: Math.round(Math.pow(2, v)) })}
          />
        </ParamRow>
        <ParamRow label={t("mixer.highCut")} hint={t("devices.tone.highCut")}>
          <Slider
            label={t("mixer.highCut")}
            value={Math.log2(fx.highCutHz)}
            min={Math.log2(1000)}
            max={Math.log2(20000)}
            step={0.01}
            reset={Math.log2(20000)}
            parse={parseLogHz}
            format={(v) => (Math.pow(2, v) >= 19900 ? t("mixer.cutOff") : `${(Math.pow(2, v) / 1000).toFixed(1)} kHz`)}
            onChange={(v) => set({ highCutHz: Math.round(Math.pow(2, v)) })}
          />
        </ParamRow>
      </div>
    </DevicePage>
  );
}

export function BusesPanel() {
  const buses = useStore((s) => s.buses);
  const [open, select] = useSelected<BusId>("ode.bus-device", BUSES, "reverb");
  const tone = (id: "soundboard" | "music" | "live") => {
    const channel = CHANNELS.find((c) => c.id === id)!;
    return { id, title: channel.name(), icon: <Equalizer /> as ReactNode, accent: channel.color, enabled: buses.channels[id].eqEnabled };
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DeviceBar
        value={open}
        onChange={select}
        groups={[
          [
            { id: "reverb", title: t("mixer.reverbBus"), icon: <Church />, accent: "var(--ch-out)", enabled: buses.reverb.enabled },
            { id: "echo", title: t("mixer.echoBus"), icon: <Repeat />, accent: "var(--ch-out)", enabled: buses.echo.enabled },
          ],
          [tone("soundboard"), tone("music"), tone("live")],
        ]}
      />
      <Crossfade id={open} order={BUSES}>
        <Bus id={open} />
      </Crossfade>
    </div>
  );
}
