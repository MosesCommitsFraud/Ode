import { EchoDisplay, EqDisplay, Module, ReverbDisplay } from "~/components/effects/rack";
import { SlideFader } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
import { EchoControls, ReverbControls } from "~/components/voice/SoundModules";
import type { ChannelId } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { formatDb } from "~/lib/utils";

/* Effekt-Busse: ein gemeinsamer Hall und ein Echo, auf die jeder Kanal mit
   eigenem Send schickt, dazu ein Klang-EQ für Soundboard, Musik und Live. */

const CHANNELS: { id: ChannelId; name: () => string; short: () => string; color: string }[] = [
  { id: "mic", name: () => t("mixer.microphone"), short: () => t("mixer.shortMic"), color: "var(--ch-mic)" },
  { id: "soundboard", name: () => t("mixer.soundboard"), short: () => t("mixer.shortSoundboard"), color: "var(--ch-soundboard)" },
  { id: "music", name: () => t("mixer.music"), short: () => t("mixer.shortMusic"), color: "var(--ch-music)" },
  { id: "live", name: () => t("mixer.live"), short: () => t("mixer.shortLive"), color: "var(--ch-live)" },
];

const percent = (v: number) => `${Math.round(v * 100)} %`;

function Sends({ bus, disabled }: { bus: "reverbSend" | "echoSend"; disabled: boolean }) {
  const channels = useStore((s) => s.buses.channels);
  return (
    <div className="flex items-end gap-2 border-l border-hairline pl-3 [&>*]:min-w-0" title={t("mixer.sendTo")}>
      {CHANNELS.map((c) => (
        <SlideFader
          key={c.id}
          label={c.short()}
          value={channels[c.id][bus]}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          color={c.color}
          disabled={disabled}
          onChange={(v) => actions.setChannelFx(c.id, { [bus]: v })}
        />
      ))}
    </div>
  );
}

function ReverbBus() {
  const p = useStore((s) => s.buses.reverb);
  return (
    <Module
      framed
      className="col-span-3"
      title={t("mixer.reverbBus")}
      accent="var(--ch-out)"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setBus("reverb", { enabled })}
      display={<ReverbDisplay size={p.size} damping={p.damping} predelayMs={p.predelayMs} mix={p.mix} color="var(--ch-out)" />}
    >
      <ReverbControls
        params={p}
        disabled={!p.enabled}
        mixLabel={t("mixer.returnLevel")}
        color="var(--ch-out)"
        onChange={(patch) => actions.setBus("reverb", patch)}
      />
      <Sends bus="reverbSend" disabled={!p.enabled} />
    </Module>
  );
}

function EchoBus() {
  const p = useStore((s) => s.buses.echo);
  return (
    <Module
      framed
      className="col-span-3"
      title={t("mixer.echoBus")}
      accent="var(--ch-out)"
      enabled={p.enabled}
      onToggle={(enabled) => actions.setBus("echo", { enabled })}
      display={<EchoDisplay timeMs={p.timeMs} feedback={p.feedback} toneHz={p.toneHz} mix={Math.max(0.3, p.mix)} color="var(--ch-out)" />}
    >
      <EchoControls
        params={p}
        disabled={!p.enabled}
        mixLabel={t("mixer.returnLevel")}
        color="var(--ch-out)"
        onChange={(patch) => actions.setBus("echo", patch)}
      />
      <Sends bus="echoSend" disabled={!p.enabled} />
    </Module>
  );
}

function ChannelTone({ id }: { id: ChannelId }) {
  const fx = useStore((s) => s.buses.channels[id]);
  const channel = CHANNELS.find((c) => c.id === id)!;
  const off = !fx.eqEnabled;
  return (
    <Module
      framed
      className="col-span-2"
      title={`${channel.name()} · ${t("mixer.tone")}`}
      accent={channel.color}
      enabled={fx.eqEnabled}
      onToggle={(eqEnabled) => actions.setChannelFx(id, { eqEnabled })}
      display={<EqDisplay low={fx.lowDb} mid={fx.midDb} high={fx.highDb} lowCut={fx.lowCutHz} highCut={fx.highCutHz} color={channel.color} />}
    >
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
          bipolar
          size="sm"
          format={(v) => `${formatDb(v)} dB`}
          color={channel.color}
          disabled={off}
          onChange={(v) => actions.setChannelFx(id, { [key]: v })}
        />
      ))}
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
        disabled={off}
        onChange={(v) => actions.setChannelFx(id, { lowCutHz: Math.round(Math.pow(2, v)) })}
      />
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
        disabled={off}
        onChange={(v) => actions.setChannelFx(id, { highCutHz: Math.round(Math.pow(2, v)) })}
      />
    </Module>
  );
}

export function BusesPanel() {
  return (
    <div className="grid min-h-0 flex-1 animate-[layout-in_260ms_var(--ease-drawer)] grid-cols-6 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
      <ReverbBus />
      <EchoBus />
      <ChannelTone id="soundboard" />
      <ChannelTone id="music" />
      <ChannelTone id="live" />
    </div>
  );
}
