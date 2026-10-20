import { ArrowCounterClockwise, FloppyDisk, X } from "@phosphor-icons/react";
import { useState } from "react";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { Console, Crossfade } from "~/components/effects/rack";
import { ActionGroup, ActionPill, Pill, PillGroup } from "~/components/ui/pills";
import { AutotuneModule, HarmonizerModule, PitchModule, VocoderModule } from "~/components/voice/PitchModules";
import { PresetBank, PresetEditor } from "~/components/voice/Presets";
import { CharacterModule, EchoModule, ModulationModule, ReverbModule } from "~/components/voice/SoundModules";
import type { Preset } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, getState, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

/* Stimme: Voice-Changer mit einer Reihe Wahltasten (Aus, Eigene, Presets,
   per Hotkey umschaltbar) und darunter den Effekten als Pult auf zwei Seiten,
   Tonhöhe und Klang. Läuft im Mikrofon-Pfad nach der Aufbereitung auf der
   Effekte-Seite. */

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

type Page = "pitch" | "sound";
const PAGE_KEY = "ode.voice-page";

function readPage(): Page {
  try {
    return localStorage.getItem(PAGE_KEY) === "sound" ? "sound" : "pitch";
  } catch {
    return "pitch";
  }
}

export function VoiceView() {
  const [page, setPageState] = useState<Page>(readPage);
  const [editing, setEditing] = useState<Preset | null>(null);
  const enabled = useStore((s) => s.effects.voice.enabled);
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
    <div className="flex h-full flex-col gap-3 overflow-hidden pt-3 pr-3 pb-3 pl-6">
      <div className="flex shrink-0 items-center gap-2">
        <PillGroup>
          <Pill active={page === "pitch"} onClick={() => setPage("pitch")}>
            {t("voice.pitchPage")}
          </Pill>
          <Pill active={page === "sound"} onClick={() => setPage("sound")}>
            {t("voice.soundPage")}
          </Pill>
        </PillGroup>
        <HelpIcon topic="presets" />
        <div className="flex-1" />
        <ActionGroup>
          <ActionPill title={t("voice.restore")} onClick={() => void actions.restorePresets()}>
            <ArrowCounterClockwise />
          </ActionPill>
          <ActionPill primary onClick={() => void save()}>
            <FloppyDisk /> {t("voice.savePreset")}
          </ActionPill>
        </ActionGroup>
      </div>

      {errors.map((e, i) => (
        <div key={`${i}-${e}`} className="flex shrink-0 items-center gap-3 rounded-2xl bg-error/10 px-4 py-2 text-sm text-error-foreground">
          <span className="flex-1">{e}</span>
          <button type="button" onClick={() => actions.dismissPresetErrors()} className="cursor-default opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}

      <PresetBank onEdit={setEditing} />

      {/* Bei ausgeschalteter Stimme bleibt das Pult bedienbar, wirkt aber erst mit „Eigene“ oder einem Preset. */}
      <Crossfade id={page} order={["pitch", "sound"]} className={cn("transition-opacity duration-300", !enabled && "opacity-55")}>
        <Console>
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
        </Console>
      </Crossfade>

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
