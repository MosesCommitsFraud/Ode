import { Church, Equalizer, Microphone, Repeat, SpeakerHigh } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { EmptyState } from "~/components/ui/misc";
import { ActiveGrid, ChainList, smooth, EchoDisplay, EqDisplay, Module, ReverbDisplay, Stack } from "~/components/effects/rack";
import { Knob, parseNumber } from "~/components/ui/knob";
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
      name="bus-reverb"
      onToggle={(enabled) => smooth(() => actions.setBus("reverb", { enabled }))}
      display={<ReverbDisplay size={p.size} damping={p.damping} predelayMs={p.predelayMs} mix={p.mix} color="var(--ch-out)" />}
    >
      <ReverbControls params={p} mixLabel={t("mixer.returnLevel")} color="var(--ch-out)" onChange={(patch) => actions.setBus("reverb", patch)} />
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
      name="bus-echo"
      onToggle={(enabled) => smooth(() => actions.setBus("echo", { enabled }))}
      display={<EchoDisplay timeMs={p.timeMs} feedback={p.feedback} toneHz={p.toneHz} mix={Math.max(0.3, p.mix)} color="var(--ch-out)" />}
    >
      <EchoControls params={p} mixLabel={t("mixer.returnLevel")} color="var(--ch-out)" onChange={(patch) => actions.setBus("echo", patch)} />
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
      name={`tone-${id}`}
      onToggle={(eqEnabled) => smooth(() => actions.setChannelFx(id, { eqEnabled }))}
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
          parse={(text) => {
            const hz = parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
            return hz && hz > 0 ? Math.log2(hz) : null;
          }}
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
          parse={(text) => {
            const hz = parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
            return hz && hz > 0 ? Math.log2(hz) : null;
          }}
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

/** Effekt-Busse wie die Effekt-Seiten: links der Signalweg mit Schaltern, rechts nur, was an ist. */
export function BusesPanel() {
  const buses = useStore((s) => s.buses);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const tone = (id: "soundboard" | "music" | "live") => {
    const channel = CHANNELS.find((c) => c.id === id)!;
    return {
      id,
      title: channel.name(),
      icon: <Equalizer />,
      accent: channel.color,
      enabled: buses.channels[id].eqEnabled,
      onToggle: (eqEnabled: boolean) => smooth(() => actions.setChannelFx(id, { eqEnabled })),
    };
  };
  const items = [
    ...(buses.reverb.enabled ? [{ id: "reverb", weight: 3, render: () => <ReverbBus highlight={flash === "reverb"} /> }] : []),
    ...(buses.echo.enabled ? [{ id: "echo", weight: 2, render: () => <EchoBus highlight={flash === "echo"} /> }] : []),
    ...(["soundboard", "music", "live"] as const)
      .filter((id) => buses.channels[id].eqEnabled)
      .map((id) => ({ id, weight: 1, render: () => <ChannelTone id={id} highlight={flash === id} /> })),
  ];

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <ChainList
        start={{ label: t("mixer.inputs"), icon: <Microphone /> }}
        end={{ label: t("mixer.outputs"), icon: <SpeakerHigh /> }}
        groups={[
          {
            title: t("mixer.buses"),
            devices: [
              {
                id: "reverb",
                title: t("mixer.reverbBus"),
                icon: <Church />,
                accent: "var(--ch-out)",
                enabled: buses.reverb.enabled,
                onToggle: (enabled: boolean) => smooth(() => actions.setBus("reverb", { enabled })),
              },
              {
                id: "echo",
                title: t("mixer.echoBus"),
                icon: <Repeat />,
                accent: "var(--ch-out)",
                enabled: buses.echo.enabled,
                onToggle: (enabled: boolean) => smooth(() => actions.setBus("echo", { enabled })),
              },
            ],
          },
          { title: t("mixer.tone"), devices: [tone("soundboard"), tone("music"), tone("live")] },
        ]}
        onFocus={setFlash}
      />
      <ActiveGrid
        empty={
          <EmptyState icon={<Church weight="duotone" />} title={t("mixer.noBusTitle")}>
            {t("mixer.noBusHint")}
          </EmptyState>
        }
        items={items}
      />
    </div>
  );
}
