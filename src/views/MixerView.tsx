import {
  ArrowCounterClockwise as RotateCcw,
  Broadcast,
  Headphones,
  Microphone as Mic,
  Plugs as Cable,
  VinylRecord as Disc3,
  Waveform as AudioWaveform,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Crossfade } from "~/components/effects/rack";
import { BusesPanel } from "~/components/mixer/BusesPanel";
import { ChannelStrip, StripToggle } from "~/components/mixer/ChannelStrip";
import { CHANNEL_DEFAULTS, OUTPUT_DEFAULTS, same } from "~/components/mixer/PageChannel";
import { Card, SectionLabel, Segmented, Switch } from "~/components/ui/misc";
import { Pill, PillGroup } from "~/components/ui/pills";
import type { ChannelId, Meters, OutputId } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { t } from "~/lib/i18n";

const CHANNELS: { id: ChannelId; name: string; icon: ReactNode; color: string; ready: boolean }[] = [
  { id: "mic", get name() { return t("mixer.microphone"); }, icon: <Mic />, color: "var(--ch-mic)", ready: true },
  { id: "soundboard", get name() { return t("mixer.soundboard"); }, icon: <AudioWaveform />, color: "var(--ch-soundboard)", ready: true },
  { id: "music", get name() { return t("mixer.music"); }, icon: <Disc3 />, color: "var(--ch-music)", ready: true },
  { id: "live", get name() { return t("mixer.live"); }, icon: <Broadcast />, color: "var(--ch-live)", ready: true },
];

const OUTPUTS: { id: OutputId; name: string; icon: ReactNode }[] = [
  { id: "a", get name() { return t("mixer.headphones"); }, icon: <Headphones /> },
  { id: "b", get name() { return t("mixer.cable"); }, icon: <Cable /> },
];

function channelPeak(meters: Meters | null, id: ChannelId) {
  return meters?.channels.find((c) => c.id === id)?.peak ?? 0;
}

function Console() {
  const channels = useStore((s) => s.channels);
  const outputs = useStore((s) => s.outputs);
  const meters = useStore((s) => s.meters);
  const running = useStore((s) => s.info !== null);
  const changed =
    Object.values(channels).some((c) => c.gainDb !== 0) || Object.values(outputs).some((o) => o.gainDb !== 0);

  return (
    <Card className="flex min-h-0 flex-1 p-1.5">
      <section className="flex flex-col">
        <div className="flex items-center justify-between pt-1.5 pr-1.5 pl-3">
          <SectionLabel>{t("mixer.inputs")}</SectionLabel>
          <button
            type="button"
            title={t("mixer.resetAll")}
            disabled={!changed}
            onClick={() => actions.resetLevels()}
            className="flex h-6 cursor-default items-center gap-1.5 rounded-full bg-muted px-2.5 font-mono text-3xs font-semibold text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 [&_svg]:size-3"
          >
            <RotateCcw /> {t("mixer.resetAllLabel")}
          </button>
        </div>
        <div className="flex flex-1 divide-x divide-hairline">
          {CHANNELS.map(({ id, name, icon, color, ready }) => {
            const params = channels[id];
            return (
              <ChannelStrip
                key={id}
                name={name}
                icon={icon}
                color={color}
                gainDb={params.gainDb}
                muted={params.muted}
                peak={channelPeak(meters, id)}
                onGain={(gainDb) => actions.setChannel(id, { gainDb })}
                onMute={(muted) => actions.setChannel(id, { muted })}
                routing={{
                  a: params.routeA,
                  b: params.routeB,
                  onA: (routeA) => actions.setChannel(id, { routeA }),
                  onB: (routeB) => actions.setChannel(id, { routeB }),
                }}
                disabled={!ready}
                isDefault={same(params, CHANNEL_DEFAULTS[id])}
                onReset={() => actions.setChannel(id, CHANNEL_DEFAULTS[id])}
              />
            );
          })}
        </div>
      </section>

      <div className="min-w-3 flex-1" />

      <section className="well flex flex-col rounded-xl">
        <SectionLabel className="flex h-[30px] items-center px-3 pt-1.5">{t("mixer.outputs")}</SectionLabel>
        <div className="flex flex-1 divide-x divide-hairline">
          {OUTPUTS.map(({ id, name, icon }) => {
            const params = outputs[id];
            const out = id === "a" ? meters?.outA : meters?.outB;
            const reducing = params.limiter && (out?.gainReductionDb ?? 0) < -0.1;
            return (
              <ChannelStrip
                key={id}
                name={name}
                icon={icon}
                color="var(--ch-out)"
                gainDb={params.gainDb}
                muted={params.muted}
                peak={running ? (out?.peak ?? 0) : 0}
                onGain={(gainDb) => actions.setOutput(id, { gainDb })}
                onMute={(muted) => actions.setOutput(id, { muted })}
                isDefault={same(params, OUTPUT_DEFAULTS[id])}
                onReset={() => actions.setOutput(id, OUTPUT_DEFAULTS[id])}
                extra={
                  <StripToggle
                    title={reducing ? t("mixer.limiterActive") : t("mixer.limiterHint")}
                    on={params.limiter}
                    onClick={() => actions.setOutput(id, { limiter: !params.limiter })}
                  >
                    <span className={cn(reducing && "text-warning-foreground")}>{t("mixer.limiterShort")}</span>
                  </StripToggle>
                }
              />
            );
          })}
        </div>
      </section>
    </Card>
  );
}

const AMOUNTS = [6, 12, 18, 24];
const SENSITIVITY: { db: number; label: string }[] = [
  { db: -50, label: "mixer.high" },
  { db: -40, label: "mixer.medium" },
  { db: -30, label: "mixer.low" },
];

/** Ducking als schmale Leiste unter dem Pult. */
function DuckingBar() {
  const ducking = useStore((s) => s.ducking);
  const duckingDb = useStore((s) => s.meters?.duckingDb ?? 0);
  const active = ducking.enabled && duckingDb < -0.5;

  return (
    <Card className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
      <div className="flex items-center gap-3">
        <Switch
          label={t("mixer.ducking")}
          checked={ducking.enabled}
          onCheckedChange={(enabled) => actions.setDucking({ enabled })}
        />
        <div className="text-sm font-semibold" title={t("mixer.duckingHint")}>
          {t("mixer.ducking")}
        </div>
      </div>

      <div className={cn("ml-auto flex items-center gap-4", !ducking.enabled && "pointer-events-none opacity-45")}>
        <div className="flex items-center gap-2">
          <SectionLabel>{t("mixer.reduction")}</SectionLabel>
          <div className="w-56">
            <Segmented
              value={ducking.amountDb}
              options={AMOUNTS}
              onChange={(amountDb) => actions.setDucking({ amountDb })}
              format={(db) => `−${db}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SectionLabel>{t("mixer.sensitivity")}</SectionLabel>
          <div className="w-56">
            <Segmented
              value={ducking.thresholdDb}
              options={SENSITIVITY.map((s) => s.db)}
              onChange={(thresholdDb) => actions.setDucking({ thresholdDb })}
              format={(db) => {
                const key = SENSITIVITY.find((s) => s.db === db)?.label;
                return key ? t(key) : `${db} dB`;
              }}
            />
          </div>
        </div>
        <span
          className={cn(
            "w-16 text-right font-mono text-2xs tabular-nums text-muted-foreground",
            active && "text-[var(--ch-soundboard)]",
          )}
        >
          {active ? `${duckingDb.toFixed(1)} dB` : t("mixer.resting")}
        </span>
      </div>
    </Card>
  );
}

type Page = "console" | "buses";
const PAGE_KEY = "ode.mixer-page";

function readPage(): Page {
  try {
    return localStorage.getItem(PAGE_KEY) === "buses" ? "buses" : "console";
  } catch {
    return "console";
  }
}

export function MixerView() {
  const [page, setPageState] = useState<Page>(readPage);
  const setPage = (next: Page) => {
    setPageState(next);
    try {
      localStorage.setItem(PAGE_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden pl-6 pr-3 pt-3 pb-3">
      <div className="flex shrink-0 items-center gap-2">
        <PillGroup>
          <Pill active={page === "console"} onClick={() => setPage("console")}>
            {t("mixer.console")}
          </Pill>
          <Pill active={page === "buses"} onClick={() => setPage("buses")}>
            {t("mixer.buses")}
          </Pill>
        </PillGroup>
      </div>
      <Crossfade id={page} order={["console", "buses"]}>
        {page === "console" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Console />
            <DuckingBar />
          </div>
        ) : (
          <BusesPanel />
        )}
      </Crossfade>
    </div>
  );
}
