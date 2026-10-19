import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Card, Switch } from "~/components/ui/misc";
import { Pill, PillGroup } from "~/components/ui/pills";
import { LANGUAGES, useT } from "~/lib/i18n";
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
  const t = useT();

  useEffect(() => {
    void setup.init();
    void setup.refreshCable();
  }, []);

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold tracking-tight">{t("setup.general")}</h2>
      <div className="mt-2">
        <Row label={t("setup.language")}>
          <PillGroup>
            {LANGUAGES.map((l) => (
              <Pill key={l.id} active={settings.language === l.id} onClick={() => setup.update({ language: l.id })}>
                {l.label}
              </Pill>
            ))}
          </PillGroup>
        </Row>
        <Row label={t("setup.closeToTray")}>
          <Switch
            label={t("setup.closeToTrayShort")}
            checked={settings.closeToTray}
            onCheckedChange={(closeToTray) => setup.update({ closeToTray })}
          />
        </Row>
        <Row label={t("setup.autostart")}>
          <Switch label="Autostart" checked={settings.autostart} onCheckedChange={(autostart) => setup.update({ autostart })} />
        </Row>
        <Row label={cable.installed ? t("setup.cableOk") : t("setup.cableMissing")}>
          {cable.installed ? (
            <Button variant="ghost" size="sm" onClick={() => setup.openSoundSettings()}>
              {t("setup.soundSettings")}
            </Button>
          ) : (
            <Button size="sm" disabled={cable.installing} onClick={() => setup.installCable()}>
              {cable.installing ? (cable.step ?? t("setup.installing")) : t("setup.install")}
            </Button>
          )}
        </Row>
        <Row label={t("setup.setupRow")}>
          <Button variant="ghost" size="sm" onClick={() => setup.update({ setupDone: false })}>
            {t("setup.restartSetup")}
          </Button>
        </Row>
      </div>
      {(error || cable.error) && <p className="mt-2 text-sm text-error-foreground">{error ?? cable.error}</p>}
      <CableCredit className="mt-3" />
    </Card>
  );
}
