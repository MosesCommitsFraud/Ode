import { Plugs as Cable, Headphones, Microphone as Mic, ArrowsClockwise as RefreshCw } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/misc";
import { Select } from "~/components/ui/select";
import type { DeviceInfo } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { PlayGlyph } from "~/components/ui/transport";

function options(devices: DeviceInfo[]) {
  return devices.map((d) => ({
    value: d.id,
    label: d.name,
    hint: d.isDefault ? "Standard" : undefined,
  }));
}

/** Eine Geräte-Zeile: Symbol und Name links, Auswahl rechts. */
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.25rem_8.5rem_1fr] items-center gap-3">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}

export function DeviceSetup() {
  const devices = useStore((s) => s.devices);
  const config = useStore((s) => s.config);
  const info = useStore((s) => s.info);
  const starting = useStore((s) => s.starting);
  const error = useStore((s) => s.error);
  const running = info !== null;

  const cables = devices.outputs.filter((d) => d.isVirtualCable);
  const noCable = devices.outputs.length > 0 && cables.length === 0;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Geräte</h2>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" title="Geräte neu laden" onClick={() => actions.refreshDevices()}>
            <RefreshCw />
          </Button>
          {!running && (
            <Button disabled={starting || !config.inputId} onClick={() => actions.start()}>
              <PlayGlyph /> {starting ? "Startet …" : "Erneut starten"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <Row icon={<Mic />} label="Mikrofon">
          <Select
            value={config.inputId}
            onChange={(inputId) => actions.setConfig({ inputId })}
            options={options(devices.inputs.filter((d) => !d.isVirtualCable))}
            placeholder="Mikrofon wählen"
          />
        </Row>
        <Row icon={<Headphones />} label="Kopfhörer">
          <Select
            value={config.monitorId ?? ""}
            onChange={(id) => actions.setConfig({ monitorId: id || null })}
            options={options(devices.outputs.filter((d) => !d.isVirtualCable))}
            placeholder="Aus"
          />
        </Row>
        <Row icon={<Cable />} label="Virtuelles Kabel">
          <Select
            value={config.cableId ?? ""}
            onChange={(id) => actions.setConfig({ cableId: id || null })}
            options={options(cables.length > 0 ? cables : devices.outputs)}
            placeholder="Aus"
          />
        </Row>
      </div>

      {noCable && (
        <p className="mt-4 rounded-xl bg-warning/12 px-3 py-2.5 text-xs text-warning-foreground">
          Kein virtuelles Kabel gefunden. Installiere VB-Cable (vb-audio.com/Cable) und lade die
          Geräte neu.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl bg-error/12 px-3 py-2.5 text-xs text-error-foreground">{error}</p>
      )}
    </Card>
  );
}
