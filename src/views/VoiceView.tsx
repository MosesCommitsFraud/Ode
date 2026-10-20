import { ArrowCounterClockwise, FloppyDisk, X } from "@phosphor-icons/react";
import { useState } from "react";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { Bench } from "~/components/effects/rack";
import { ActionGroup, ActionPill } from "~/components/ui/pills";
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

const OPEN_KEY = "ode.voice-open";
const DEVICES = ["pitch", "autotune", "harmonizer", "vocoder", "character", "modulation", "echo", "reverb"] as const;
type DeviceId = (typeof DEVICES)[number];

function readOpen(): DeviceId {
  try {
    const stored = localStorage.getItem(OPEN_KEY);
    return DEVICES.find((d) => d === stored) ?? "pitch";
  } catch {
    return "pitch";
  }
}

const MODULES: Record<DeviceId, () => React.ReactNode> = {
  pitch: PitchModule,
  autotune: AutotuneModule,
  harmonizer: HarmonizerModule,
  vocoder: VocoderModule,
  character: CharacterModule,
  modulation: ModulationModule,
  echo: EchoModule,
  reverb: ReverbModule,
};

export function VoiceView() {
  const [open, setOpen] = useState<DeviceId>(readOpen);
  const [editing, setEditing] = useState<Preset | null>(null);
  const voice = useStore((s) => s.effects.voice);
  const errors = useStore((s) => s.presetErrors);

  const select = (id: string) => {
    const next = DEVICES.find((d) => d === id) ?? "pitch";
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next);
    } catch {
      // Nur Komfort.
    }
  };
  const save = async () => {
    const preset = newPreset();
    await actions.savePreset(preset);
    setEditing(preset);
  };
  const item = (id: DeviceId) => ({
    id,
    title: t(`voice.${id}`),
    enabled: voice[id].enabled,
    onToggle: (enabled: boolean) => actions.setVoice(id, { enabled }),
  });
  const Device = MODULES[open];

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden pt-3 pr-3 pb-3 pl-6">
      {errors.map((e, i) => (
        <div key={`${i}-${e}`} className="flex shrink-0 items-center gap-3 rounded-2xl bg-error/10 px-4 py-2 text-sm text-error-foreground">
          <span className="flex-1">{e}</span>
          <button type="button" onClick={() => actions.dismissPresetErrors()} className="cursor-default opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}

      <PresetBank
        onEdit={setEditing}
        aside={
          <div className="flex shrink-0 flex-col items-end justify-between gap-2 self-stretch py-1 pr-1 pl-2">
            <HelpIcon topic="presets" />
            <ActionGroup>
              <ActionPill title={t("voice.restore")} onClick={() => void actions.restorePresets()}>
                <ArrowCounterClockwise />
              </ActionPill>
              <ActionPill primary onClick={() => void save()}>
                <FloppyDisk /> {t("voice.savePreset")}
              </ActionPill>
            </ActionGroup>
          </div>
        }
      />

      {/* Bei ausgeschalteter Stimme bleibt alles bedienbar, wirkt aber erst mit „Eigene“ oder einem Preset. */}
      <Bench
        className={cn("transition-opacity duration-300", !voice.enabled && "opacity-60")}
        open={open}
        onOpen={select}
        items={[
          { group: t("voice.pitchPage") },
          item("pitch"),
          item("autotune"),
          item("harmonizer"),
          item("vocoder"),
          { group: t("voice.soundPage") },
          item("character"),
          item("modulation"),
          item("echo"),
          item("reverb"),
        ]}
      >
        <Device />
      </Bench>

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
