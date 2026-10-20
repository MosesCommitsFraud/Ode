import { ArrowCounterClockwise, FloppyDisk, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Crossfade, DeviceBar, useSelected } from "~/components/effects/device";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { ActionGroup, ActionPill } from "~/components/ui/pills";
import { PresetBank, PresetEditor } from "~/components/voice/Presets";
import { VOICE_DEVICES, VOICE_ICONS, VoiceDevice, type VoiceDeviceId } from "~/components/voice/VoiceDevices";
import type { Preset } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { actions, getState, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

/* Stimme: Voice-Changer mit einer Reihe Wahltasten (Aus, Eigene, Presets,
   per Hotkey umschaltbar), darunter die Stimm-Effekte zum Durchschalten und
   der gewählte Effekt mit allen Einstellungen. Läuft im Mikrofon-Pfad nach
   der Aufbereitung auf der Effekte-Seite. */

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
  const [open, select] = useSelected<VoiceDeviceId>("ode.voice-device", VOICE_DEVICES, "pitch");
  const [editing, setEditing] = useState<Preset | null>(null);
  const voice = useStore((s) => s.effects.voice);
  const errors = useStore((s) => s.presetErrors);

  const save = async () => {
    const preset = newPreset();
    await actions.savePreset(preset);
    setEditing(preset);
  };
  const key = (id: VoiceDeviceId) => ({ id, title: t(`voice.${id}`), icon: VOICE_ICONS[id], enabled: voice[id].enabled });

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

      <DeviceBar
        value={open}
        onChange={select}
        groups={[(["pitch", "autotune", "harmonizer", "vocoder"] as const).map(key), (["character", "modulation", "echo", "reverb"] as const).map(key)]}
      />

      {/* Bei ausgeschalteter Stimme bleibt alles bedienbar, wirkt aber erst mit „Eigene“ oder einem Preset. */}
      <Crossfade id={open} order={VOICE_DEVICES} className={cn("transition-opacity duration-300", !voice.enabled && "opacity-60")}>
        <VoiceDevice id={open} />
      </Crossfade>

      {editing && <PresetEditor key={editing.id} preset={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
