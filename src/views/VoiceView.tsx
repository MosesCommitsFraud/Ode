import { ArrowCounterClockwise, FloppyDisk, X } from "@phosphor-icons/react";
import { useState } from "react";
import { HelpButton } from "~/components/effects/HelpDrawer";
import { PageBar } from "~/components/effects/rack";
import { Badge, Switch } from "~/components/ui/misc";
import { ActionGroup, ActionPill, Pill, PillGroup } from "~/components/ui/pills";
import { AutotuneModule, HarmonizerModule, PitchModule, VocoderModule } from "~/components/voice/PitchModules";
import { PresetBank, PresetEditor, presetName, sameVoice } from "~/components/voice/Presets";
import { CharacterModule, EchoModule, ModulationModule, ReverbModule } from "~/components/voice/SoundModules";
import type { Preset } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, getState, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

/* Stimme: Voice-Changer mit Presets (per Hotkey umschaltbar) und den
   Effekten auf zwei Seiten, Tonhöhe und Klang. Läuft im Mikrofon-Pfad nach
   der Aufbereitung auf der Effekte-Seite. */

type Page = "presets" | "pitch" | "sound";
const PAGE_KEY = "ode.voice-page";

function readPage(): Page {
  try {
    const stored = localStorage.getItem(PAGE_KEY);
    return stored === "pitch" || stored === "sound" ? stored : "presets";
  } catch {
    return "presets";
  }
}

/** Welches Preset gerade läuft, ob es verändert wurde oder alles aus ist. */
function Status() {
  const voice = useStore((s) => s.effects.voice);
  const presets = useStore((s) => s.presets);
  const active = useStore((s) => s.activePreset);
  const preset = presets.find((p) => p.id === active);
  if (!voice.enabled) return <Badge className="shrink-0 whitespace-nowrap">{t("voice.off")}</Badge>;
  if (!preset) return <Badge className="shrink-0 whitespace-nowrap">{t("voice.custom")}</Badge>;
  return (
    <Badge tone="primary" className="min-w-0 shrink whitespace-nowrap">
      {presetName(preset)}
      {!sameVoice(preset.voice, voice) && ` · ${t("voice.modified")}`}
    </Badge>
  );
}

function newPreset(): Preset {
  const { effects } = getState();
  return {
    id: `u${Date.now().toString(36)}`,
    name: t("voice.newPreset"),
    icon: "waveform",
    color: "orange",
    hotkey: null,
    hotkeyLabel: null,
    builtin: false,
    voice: { ...effects.voice, enabled: true },
  };
}

export function VoiceView() {
  const [page, setPageState] = useState<Page>(readPage);
  const [editing, setEditing] = useState<Preset | null>(null);
  const enabled = useStore((s) => s.effects.voice.enabled);
  const latency = useStore((s) => (s.info ? (s.meters?.effects.voiceLatencyMs ?? 0) : 0));
  const errors = useStore((s) => s.presetErrors);

  const setPage = (next: Page) => {
    setPageState(next);
    try {
      localStorage.setItem(PAGE_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };

  const save = async () => {
    const preset = newPreset();
    await actions.savePreset(preset);
    setEditing(preset);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageBar>
        <PillGroup>
          <Pill active={page === "presets"} onClick={() => setPage("presets")}>
            {t("voice.presets")}
          </Pill>
          <Pill active={page === "pitch"} onClick={() => setPage("pitch")}>
            {t("voice.pitchPage")}
          </Pill>
          <Pill active={page === "sound"} onClick={() => setPage("sound")}>
            {t("voice.soundPage")}
          </Pill>
        </PillGroup>
        <Status />
        <div className="flex-1" />
        {latency > 0 && (
          <span title={t("voice.latencyHint")} className="shrink-0 font-mono text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
            {t("voice.latency", { ms: Math.round(latency) })}
          </span>
        )}
        <HelpButton
          topics={
            page === "presets"
              ? ["presets"]
              : page === "pitch"
                ? ["pitch", "autotune", "harmonizer", "vocoder"]
                : ["character", "modulation", "echo", "reverb"]
          }
        />
        <label className="flex items-center gap-2 text-xs font-semibold">
          <Switch label={t("voice.on")} checked={enabled} onCheckedChange={(on) => (on ? actions.setVoiceEnabled(true) : void actions.presetOff())} />
          <span className="hidden lg:inline">{t("voice.on")}</span>
        </label>
        <ActionGroup>
          {page === "presets" && (
            <ActionPill title={t("voice.restore")} onClick={() => void actions.restorePresets()}>
              <ArrowCounterClockwise />
            </ActionPill>
          )}
          <ActionPill primary onClick={() => void save()}>
            <FloppyDisk /> {t("voice.savePreset")}
          </ActionPill>
        </ActionGroup>
      </PageBar>

      {errors.length > 0 && (
        <div className="mr-3 mb-3 ml-6 space-y-1.5">
          {errors.map((e, i) => (
            <div key={`${i}-${e}`} className="flex items-center gap-3 rounded-2xl bg-error/10 px-4 py-2 text-sm text-error-foreground">
              <span className="flex-1">{e}</span>
              <button type="button" onClick={() => actions.dismissPresetErrors()} className="cursor-default opacity-70 hover:opacity-100">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {page === "presets" ? (
        <PresetBank onEdit={setEditing} />
      ) : (
        <div
          key={page}
          className={cn(
            "grid min-h-0 flex-1 animate-[layout-in_260ms_var(--ease-drawer)] grid-cols-2 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 pr-3 pb-3 pl-6 transition-opacity",
            !enabled && "opacity-60",
          )}
        >
          {page === "pitch" ? (
            <>
              <PitchModule />
              <AutotuneModule />
              <HarmonizerModule />
              <VocoderModule />
            </>
          ) : (
            <>
              <CharacterModule />
              <ModulationModule />
              <EchoModule />
              <ReverbModule />
            </>
          )}
        </div>
      )}

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
