import { EchoDisplay, EqDisplay, Module, Range, ReverbDisplay } from "~/components/effects/rack";
import { EchoControls, ReverbControls } from "~/components/voice/SoundModules";
import { SectionLabel } from "~/components/ui/misc";
import type { ChannelId } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, useStore } from "~/lib/store";
import { formatDb } from "~/lib/utils";

/* Effekt-Busse: ein gemeinsamer Hall und ein Echo, auf die jeder Kanal mit
   eigenem Send schickt, dazu ein Klang-EQ für Soundboard, Musik und Live. */

const CHANNELS: { id: ChannelId; name: () => string; color: string }[] = [
  { id: "mic", name: () => t("mixer.microphone"), color: "var(--ch-mic)" },
  { id: "soundboard", name: () => t("mixer.soundboard"), color: "var(--ch-soundboard)" },
  { id: "music", name: () => t("mixer.music"), color: "var(--ch-music)" },
  { id: "live", name: () => t("mixer.live"), color: "var(--ch-live)" },
];

const percent = (v: number) => `${Math.round(v * 100)} %`;

function Sends({ bus, disabled }: { bus: "reverbSend" | "echoSend"; disabled: boolean }) {
  const channels = useStore((s) => s.buses.channels);
  return (
    <>
      <SectionLabel className="col-span-full -mb-1">{t("mixer.sendTo")}</SectionLabel>
      {CHANNELS.map((c) => (
        <Range
          key={c.id}
          label={c.name()}
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
    </>
  );
}

function ReverbBus() {
  const p = useStore((s) => s.buses.reverb);
  return (
    <Module
      className="col-span-3"
      title={t("mixer.reverbBus")}
      columns={5}
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
      <div className="col-span-full grid grid-cols-4 gap-x-3 gap-y-2.5">
        <Sends bus="reverbSend" disabled={!p.enabled} />
      </div>
    </Module>
  );
}

function EchoBus() {
  const p = useStore((s) => s.buses.echo);
  return (
    <Module
      className="col-span-3"
      title={t("mixer.echoBus")}
      columns={4}
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
      className="col-span-2"
      title={`${channel.name()} · ${t("mixer.tone")}`}
      columns={3}
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
        <Range
          key={key}
          label={label}
          value={fx[key]}
          min={-12}
          max={12}
          step={0.5}
          format={(v) => `${formatDb(v)} dB`}
          color={channel.color}
          disabled={off}
          onChange={(v) => actions.setChannelFx(id, { [key]: v })}
        />
      ))}
      <Range
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
      <Range
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
