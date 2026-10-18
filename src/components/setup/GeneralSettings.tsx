import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Card, SectionLabel, Switch } from "~/components/ui/misc";
import { setup, useSetup } from "~/lib/setup";
import { CableCredit } from "./SetupWizard";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/** Allgemeine Einstellungen: Tray, Autostart, virtuelles Kabel, Einrichtung. */
export function GeneralSettings() {
  const settings = useSetup((s) => s.settings);
  const cable = useSetup((s) => s.cable);
  const error = useSetup((s) => s.error);

  useEffect(() => {
    void setup.init();
    void setup.refreshCable();
  }, []);

  return (
    <Card className="p-5">
      <SectionLabel>Allgemein</SectionLabel>
      <div className="mt-2">
        <Row label="Beim Schließen im Tray weiterlaufen">
          <Switch
            label="Im Tray weiterlaufen"
            checked={settings.closeToTray}
            onCheckedChange={(closeToTray) => setup.update({ closeToTray })}
          />
        </Row>
        <Row label="Mit Windows starten">
          <Switch label="Autostart" checked={settings.autostart} onCheckedChange={(autostart) => setup.update({ autostart })} />
        </Row>
        <Row label={cable.installed ? "VB-CABLE installiert" : "VB-CABLE fehlt"}>
          {cable.installed ? (
            <Button variant="ghost" size="sm" onClick={() => setup.openSoundSettings()}>
              Soundeinstellungen
            </Button>
          ) : (
            <Button size="sm" disabled={cable.installing} onClick={() => setup.installCable()}>
              {cable.installing ? (cable.step ?? "Installiert …") : "Installieren"}
            </Button>
          )}
        </Row>
        <Row label="Einrichtung">
          <Button variant="ghost" size="sm" onClick={() => setup.update({ setupDone: false })}>
            Erneut starten
          </Button>
        </Row>
      </div>
      {(error || cable.error) && <p className="mt-2 text-sm text-error-foreground">{error ?? cable.error}</p>}
      <CableCredit className="mt-3" />
    </Card>
  );
}
