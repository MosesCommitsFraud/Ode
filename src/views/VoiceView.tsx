import { ArrowCounterClockwise, FloppyDisk, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { Bench, DeviceGrid } from "~/components/effects/rack";
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

const KEY = "ode.voice-open";
const GROUPS = {
  pitch: ["pitch", "autotune", "harmonizer", "vocoder"],
  sound: ["character", "modulation", "echo", "reverb"],
} as const;
type GroupId = keyof typeof GROUPS;
type DeviceId = (typeof GROUPS)[GroupId][number];

function readOpen(): { group: GroupId; device?: string } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "") as { group: string; device?: string };
    return { group: value.group === "sound" ? "sound" : "pitch", device: value.device };
  } catch {
    return { group: "pitch" };
  }
}

const MODULES: Record<DeviceId, (props: { highlight?: boolean }) => React.ReactNode> = {
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
  const [state, setState] = useState(readOpen);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<Preset | null>(null);
  const voice = useStore((s) => s.effects.voice);
  const errors = useStore((s) => s.presetErrors);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const open = (group: string, device?: string) => {
    const value = { group: group === "sound" ? ("sound" as const) : ("pitch" as const), device };
    setState(value);
    if (device) setFlash(device);
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Nur Komfort.
    }
  };
  const save = async () => {
    const preset = newPreset();
    await actions.savePreset(preset);
    setEditing(preset);
  };
  const device = (id: DeviceId) => ({
    id,
    title: t(`voice.${id}`),
    enabled: voice[id].enabled,
    onToggle: (enabled: boolean) => actions.setVoice(id, { enabled }),
  });

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
        open={state.group}
        focus={state.device}
        onOpen={open}
        groups={[
          { id: "pitch", title: t("voice.pitchPage"), devices: GROUPS.pitch.map(device) },
          { id: "sound", title: t("voice.soundPage"), devices: GROUPS.sound.map(device) },
        ]}
      >
        {/* Unter der Preset-Leiste ist es flach: vier Geräte nebeneinander statt 2 × 2. */}
        <DeviceGrid count={4} columns={4}>
          {GROUPS[state.group].map((id) => {
            const Device = MODULES[id];
            return <Device key={id} highlight={flash === id} />;
          })}
        </DeviceGrid>
      </Bench>

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
