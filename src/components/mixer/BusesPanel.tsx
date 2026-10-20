import { useEffect, useState } from "react";
import { Bench, DeviceGrid, Divider, EchoDisplay, EqDisplay, Module, ReverbDisplay, Stack } from "~/components/effects/rack";
import { Knob } from "~/components/ui/knob";
import { EchoControls, ReverbControls } from "~/components/voice/SoundModules";
import type { ChannelId } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { formatDb } from "~/lib/utils";

/* Effekt-Busse als Pult: ein gemeinsamer Hall und ein Echo, auf die jeder
   Kanal mit eigenem Send schickt, dazu ein Klang-EQ für Soundboard, Musik und
   Live. Gleiche Geräte wie auf den Effekt-Seiten. */

const CHANNELS: { id: ChannelId; name: () => string; short: () => string; color: string }[] = [
  { id: "mic", name: () => t("mixer.microphone"), short: () => t("mixer.shortMic"), color: "var(--ch-mic)" },
  { id: "soundboard", name: () => t("mixer.soundboard"), short: () => t("mixer.shortSoundboard"), color: "var(--ch-soundboard)" },
  { id: "music", name: () => t("mixer.music"), short: () => t("mixer.shortMusic"), color: "var(--ch-music)" },
  { id: "live", name: () => t("mixer.live"), short: () => t("mixer.shortLive"), color: "var(--ch-live)" },
];

const percent = (v: number) => `${Math.round(v * 100)} %`;

/** Wie viel jeder Kanal auf den Bus schickt: kleine Drehregler in Kanalfarbe. */
function Sends({ bus }: { bus: "reverbSend" | "echoSend" }) {
  const channels = useStore((s) => s.buses.channels);
  return (
    <>
      {CHANNELS.map((c) => (
        <Knob
          key={c.id}
          size="sm"
          label={c.short()}
          value={channels[c.id][bus]}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          color={c.color}
          onChange={(v) => actions.setChannelFx(c.id, { [bus]: v })}
        />
      ))}
    </>
  );
}

function ReverbBus({ highlight }: { highlight: boolean }) {
  const p = useStore((s) => s.buses.reverb);
  return (
    <Module
      highlight={highlight}
      title={t("mixer.reverbBus")}
      accent="var(--ch-out)"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setBus("reverb", { enabled })}
      display={<ReverbDisplay size={p.size} damping={p.damping} predelayMs={p.predelayMs} mix={p.mix} color="var(--ch-out)" />}
    >
      <ReverbControls params={p} mixLabel={t("mixer.returnLevel")} color="var(--ch-out)" onChange={(patch) => actions.setBus("reverb", patch)} />
      <Divider />
      <Sends bus="reverbSend" />
    </Module>
  );
}

function EchoBus({ highlight }: { highlight: boolean }) {
  const p = useStore((s) => s.buses.echo);
  return (
    <Module
      highlight={highlight}
      title={t("mixer.echoBus")}
      accent="var(--ch-out)"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setBus("echo", { enabled })}
      display={<EchoDisplay timeMs={p.timeMs} feedback={p.feedback} toneHz={p.toneHz} mix={Math.max(0.3, p.mix)} color="var(--ch-out)" />}
    >
      <EchoControls params={p} mixLabel={t("mixer.returnLevel")} color="var(--ch-out)" onChange={(patch) => actions.setBus("echo", patch)} />
      <Divider />
      <Sends bus="echoSend" />
    </Module>
  );
}

function ChannelTone({ id, highlight }: { id: ChannelId; highlight: boolean }) {
  const fx = useStore((s) => s.buses.channels[id]);
  const channel = CHANNELS.find((c) => c.id === id)!;
  return (
    <Module
      highlight={highlight}
      title={`${channel.name()} · ${t("mixer.tone")}`}
      accent={channel.color}
      enabled={fx.eqEnabled}
      onToggle={(eqEnabled) => actions.setChannelFx(id, { eqEnabled })}
      display={<EqDisplay low={fx.lowDb} mid={fx.midDb} high={fx.highDb} lowCut={fx.lowCutHz} highCut={fx.highCutHz} color={channel.color} />}
    >
      <Stack>
        {(
          [
            ["lowDb", t("effects.bass")],
            ["midDb", t("effects.presence")],
            ["highDb", t("effects.treble")],
          ] as const
        ).map(([key, label]) => (
          <Knob
            key={key}
            label={label}
            value={fx[key]}
            min={-12}
            max={12}
            step={0.5}
            reset={0}
            bipolar
            ticks={9}
            format={(v) => `${formatDb(v)} dB`}
            color={channel.color}
            onChange={(v) => actions.setChannelFx(id, { [key]: v })}
          />
        ))}
      </Stack>
      <Stack>
        <Knob
          size="sm"
          label={t("mixer.highCut")}
          value={Math.log2(fx.highCutHz)}
          min={Math.log2(1000)}
          max={Math.log2(20000)}
          step={0.01}
          reset={Math.log2(20000)}
          format={(v) => (Math.pow(2, v) >= 19900 ? t("mixer.cutOff") : `${(Math.pow(2, v) / 1000).toFixed(1)} kHz`)}
          color={channel.color}
          onChange={(v) => actions.setChannelFx(id, { highCutHz: Math.round(Math.pow(2, v)) })}
        />
        <Knob
          size="sm"
          label={t("mixer.lowCut")}
          value={Math.log2(fx.lowCutHz)}
          min={Math.log2(20)}
          max={Math.log2(1000)}
          step={0.01}
          reset={Math.log2(20)}
          format={(v) => (Math.pow(2, v) <= 20.5 ? t("mixer.cutOff") : `${Math.round(Math.pow(2, v))} Hz`)}
          color={channel.color}
          onChange={(v) => actions.setChannelFx(id, { lowCutHz: Math.round(Math.pow(2, v)) })}
        />
      </Stack>
    </Module>
  );
}

const KEY = "ode.buses-open";
type GroupId = "buses" | "tone";

function readOpen(): { group: GroupId; device?: string } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "") as { group: string; device?: string };
    return { group: value.group === "tone" ? "tone" : "buses", device: value.device };
  } catch {
    return { group: "buses" };
  }
}

/**
 * Effekt-Busse wie die Effekt-Seiten: links die Liste mit Schaltern, rechts
 * die Geräte der Gruppe nebeneinander (Hall und Echo, oder die drei Klang-EQs).
 */
export function BusesPanel() {
  const buses = useStore((s) => s.buses);
  const [state, setState] = useState(readOpen);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const open = (group: string, device?: string) => {
    const value = { group: group === "tone" ? ("tone" as const) : ("buses" as const), device };
    setState(value);
    if (device) setFlash(device);
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Nur Komfort.
    }
  };
  const tone = (id: "soundboard" | "music" | "live") => {
    const channel = CHANNELS.find((c) => c.id === id)!;
    return {
      id,
      title: channel.name(),
      accent: channel.color,
      enabled: buses.channels[id].eqEnabled,
      onToggle: (eqEnabled: boolean) => actions.setChannelFx(id, { eqEnabled }),
    };
  };

  return (
    <Bench
      open={state.group}
      focus={state.device}
      onOpen={open}
      groups={[
        {
          id: "buses",
          title: t("mixer.buses"),
          devices: [
            { id: "reverb", title: t("mixer.reverbBus"), accent: "var(--ch-out)", enabled: buses.reverb.enabled, onToggle: (enabled: boolean) => actions.setBus("reverb", { enabled }) },
            { id: "echo", title: t("mixer.echoBus"), accent: "var(--ch-out)", enabled: buses.echo.enabled, onToggle: (enabled: boolean) => actions.setBus("echo", { enabled }) },
          ],
        },
        { id: "tone", title: t("mixer.tone"), devices: [tone("soundboard"), tone("music"), tone("live")] },
      ]}
    >
      {state.group === "buses" ? (
        <DeviceGrid count={2}>
          <ReverbBus highlight={flash === "reverb"} />
          <EchoBus highlight={flash === "echo"} />
        </DeviceGrid>
      ) : (
        <DeviceGrid count={3}>
          {(["soundboard", "music", "live"] as const).map((id) => (
            <ChannelTone key={id} id={id} highlight={flash === id} />
          ))}
        </DeviceGrid>
      )}
    </Bench>
  );
}
