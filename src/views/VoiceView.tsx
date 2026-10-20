import { ArrowCounterClockwise, ArrowsDownUp, Church, FloppyDisk, MaskHappy, Microphone, MusicNotes, Repeat, Robot, SpeakerHigh, UsersThree, WaveSine, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { ActiveGrid, ChainList, smooth } from "~/components/effects/rack";
import { EmptyState } from "~/components/ui/misc";
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

const GROUPS = {
  pitch: ["pitch", "autotune", "harmonizer", "vocoder"],
  sound: ["character", "modulation", "echo", "reverb"],
} as const;
type DeviceId = (typeof GROUPS)[keyof typeof GROUPS][number];

const ICONS: Record<DeviceId, React.ReactNode> = {
  pitch: <ArrowsDownUp />,
  autotune: <MusicNotes />,
  harmonizer: <UsersThree />,
  vocoder: <Robot />,
  character: <MaskHappy />,
  modulation: <WaveSine />,
  echo: <Repeat />,
  reverb: <Church />,
};

/** Welche Anzeige am meisten Platz verdient, wenn welcher übrig ist. */
const WEIGHT: Record<DeviceId, number> = { autotune: 8, reverb: 7, pitch: 6, vocoder: 5, harmonizer: 4, echo: 3, character: 2, modulation: 1 };

const MODULES: Record<DeviceId, (props: { highlight?: boolean; className?: string }) => React.ReactNode> = {
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
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<Preset | null>(null);
  const voice = useStore((s) => s.effects.voice);
  const errors = useStore((s) => s.presetErrors);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const save = async () => {
    const preset = newPreset();
    await actions.savePreset(preset);
    setEditing(preset);
  };
  const toggle = (id: DeviceId, enabled: boolean) => smooth(() => actions.setVoice(id, { enabled }));
  const chain = (id: DeviceId) => ({ id, title: t(`voice.${id}`), icon: ICONS[id], enabled: voice[id].enabled, onToggle: (on: boolean) => toggle(id, on) });
  const active = [...GROUPS.pitch, ...GROUPS.sound].filter((id) => voice[id].enabled);

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
      <div className={cn("flex min-h-0 flex-1 gap-3 transition-opacity duration-300", !voice.enabled && "opacity-60")}>
        <ChainList
          start={{ label: t("effects.input"), icon: <Microphone /> }}
          end={{ label: t("effects.output"), icon: <SpeakerHigh /> }}
          groups={[
            { title: t("voice.pitchPage"), devices: GROUPS.pitch.map(chain) },
            { title: t("voice.soundPage"), devices: GROUPS.sound.map(chain) },
          ]}
          onFocus={setFlash}
        />
        <ActiveGrid
          // Stimm-Geräte haben viele Regler: lieber schmaler als zu flach.
          min={{ width: 180, height: 220 }}
          empty={
            <EmptyState icon={<Microphone weight="duotone" />} title={t("voice.noneTitle")}>
              {t("voice.noneHint")}
            </EmptyState>
          }
          items={active.map((id) => {
            const Device = MODULES[id];
            return { id, weight: WEIGHT[id], render: (className: string) => <Device highlight={flash === id} className={className} /> };
          })}
        />
      </div>

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
