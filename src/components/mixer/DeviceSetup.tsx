import { AudioLines, Cable, Headphones, Mic, Play, RefreshCw, Square } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Badge, Card, SectionLabel } from "~/components/ui/misc";
import { Select } from "~/components/ui/select";
import type { DeviceInfo, StreamInfo } from "~/lib/engine";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

function options(devices: DeviceInfo[], icon: ReactNode) {
  return devices.map((d) => ({
    value: d.id,
    label: d.name,
    hint: d.isDefault ? "Standard" : undefined,
    icon,
  }));
}

function streamText(s: StreamInfo | null | undefined) {
  return s ? `${(s.sampleRate / 1000).toFixed(1)} kHz · ${s.channels} ch · ${s.sampleFormat}` : null;
}

/** Ein Knoten im Signalweg: Symbol auf der Leitung, rechts die Geräteauswahl. */
function Node({
  icon,
  color,
  label,
  detail,
  stream,
  live,
  last,
  children,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  detail: string;
  stream?: string | null;
  live: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ "--ch": color } as CSSProperties} className="relative grid grid-cols-[2.5rem_9.5rem_1fr] items-center gap-3">
      {!last && (
        <span
          className={cn(
            "absolute top-10 bottom-[-0.75rem] left-[1.25rem] w-0.5 -translate-x-1/2 rounded-full",
            live
              ? "animate-[flow_0.6s_linear_infinite] bg-[repeating-linear-gradient(to_bottom,var(--ch)_0_8px,transparent_8px_16px)] opacity-70"
              : "bg-border",
          )}
        />
      )}
      <span
        className={cn(
          "relative z-10 flex size-10 items-center justify-center rounded-full border-2 transition-all [&_svg]:size-4",
          live
            ? "border-[var(--ch)] bg-[color-mix(in_oklch,var(--ch)_16%,var(--panel))] text-[var(--ch)] shadow-[0_0_16px_-4px_var(--ch)]"
            : "border-border bg-panel text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate font-mono text-3xs text-muted-foreground">{stream ?? detail}</div>
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
    <Card className="p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Signalweg</SectionLabel>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Geräte</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mikrofon rein, Kopfhörer zum Mithören, Kabel als Mikro für Discord und Spiele.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" title="Geräte neu laden" onClick={() => actions.refreshDevices()}>
            <RefreshCw />
          </Button>
          {running ? (
            <Button variant="outline" onClick={() => actions.stop()}>
              <Square className="fill-current" /> Stoppen
            </Button>
          ) : (
            <Button disabled={starting || !config.inputId} onClick={() => actions.start()}>
              <Play className="fill-current" /> {starting ? "Startet …" : "Engine starten"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <Node
          icon={<Mic />}
          color="var(--ch-mic)"
          label="Mikrofon"
          detail="Eingang"
          stream={streamText(info?.input)}
          live={running}
        >
          <Select
            value={config.inputId}
            onChange={(inputId) => actions.setConfig({ inputId })}
            options={options(devices.inputs.filter((d) => !d.isVirtualCable), <Mic />)}
            placeholder="Mikrofon wählen"
          />
        </Node>
        <Node
          icon={<AudioLines />}
          color="var(--primary)"
          label="Ode"
          detail="Mischpult und Effekte"
          live={running}
        >
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={running ? "primary" : "default"}>{running ? "läuft" : "gestoppt"}</Badge>
            <Badge>{config.bufferMs} ms Puffer</Badge>
          </div>
        </Node>
        <Node
          icon={<Headphones />}
          color="var(--ch-out)"
          label="Kopfhörer"
          detail="Ausgang A"
          stream={streamText(info?.monitor)}
          live={running && !!info?.monitor}
        >
          <Select
            value={config.monitorId ?? ""}
            onChange={(id) => actions.setConfig({ monitorId: id || null })}
            options={options(devices.outputs.filter((d) => !d.isVirtualCable), <Headphones />)}
            placeholder="Aus"
          />
        </Node>
        <Node
          icon={<Cable />}
          color="var(--ch-out)"
          label="Virtuelles Kabel"
          detail="Ausgang B"
          stream={streamText(info?.cable)}
          live={running && !!info?.cable}
          last
        >
          <Select
            value={config.cableId ?? ""}
            onChange={(id) => actions.setConfig({ cableId: id || null })}
            options={options(cables.length > 0 ? cables : devices.outputs, <Cable />)}
            placeholder="Aus"
          />
        </Node>
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
