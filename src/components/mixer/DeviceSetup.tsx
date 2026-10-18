import { Cable, Headphones, Mic, Play, RefreshCw, Square } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Badge, Card, Select } from "~/components/ui/misc";
import type { DeviceInfo } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";

function options(devices: DeviceInfo[]) {
  return devices.map((d) => ({
    value: d.id,
    label: d.name,
    hint: d.isDefault ? "Standard" : undefined,
  }));
}

function Row({
  icon,
  label,
  detail,
  children,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        <div className="leading-tight">
          <div>{label}</div>
          {detail && <div className="text-2xs text-muted-foreground">{detail}</div>}
        </div>
      </div>
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
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Geräte</h2>
          <p className="text-xs text-muted-foreground">
            Mikrofon rein, Kopfhörer zum Mithören, Kabel als Mikro für Discord und Spiele.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title="Geräte neu laden" onClick={() => actions.refreshDevices()}>
            <RefreshCw />
          </Button>
          {running ? (
            <Button variant="outline" size="sm" onClick={() => actions.stop()}>
              <Square /> Stoppen
            </Button>
          ) : (
            <Button size="sm" disabled={starting || !config.inputId} onClick={() => actions.start()}>
              <Play /> {starting ? "Startet …" : "Engine starten"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <Row icon={<Mic />} label="Mikrofon" detail="Eingang">
          <Select
            value={config.inputId}
            onChange={(inputId) => actions.setConfig({ inputId })}
            options={options(devices.inputs.filter((d) => !d.isVirtualCable))}
            placeholder="Mikrofon wählen"
          />
        </Row>
        <Row icon={<Headphones />} label="Kopfhörer" detail="Ausgang A">
          <Select
            value={config.monitorId ?? ""}
            onChange={(id) => actions.setConfig({ monitorId: id || null })}
            options={options(devices.outputs.filter((d) => !d.isVirtualCable))}
            placeholder="Aus"
          />
        </Row>
        <Row icon={<Cable />} label="Virtuelles Kabel" detail="Ausgang B">
          <Select
            value={config.cableId ?? ""}
            onChange={(id) => actions.setConfig({ cableId: id || null })}
            options={options(cables.length > 0 ? cables : devices.outputs)}
            placeholder="Aus"
          />
        </Row>
      </div>

      {noCable && (
        <p className="mt-3 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning-foreground">
          Kein virtuelles Kabel gefunden. Installiere VB-Cable oder Virtual Audio Cable Lite und lade
          die Geräte neu.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-error/10 px-2.5 py-2 text-xs text-error-foreground">{error}</p>
      )}

      {info && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {[info.input, info.monitor, info.cable].map(
            (s, i) =>
              s && (
                <Badge key={i}>
                  {["Ein", "A", "B"][i]} · {(s.sampleRate / 1000).toFixed(1)} kHz · {s.channels} ch ·{" "}
                  {s.sampleFormat}
                </Badge>
              ),
          )}
        </div>
      )}
    </Card>
  );
}
