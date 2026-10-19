import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CircleNotch as Loader2 } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { isTauri } from "~/lib/engine";
import { useT } from "~/lib/i18n";
import { setup, useSetup } from "~/lib/setup";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";

const STEPS = ["setup.stepCable", "setup.stepDevices", "setup.stepDiscord"] as const;

/** Herkunftsangabe, die VB-Audio für die Weitergabe verlangt. */
export function CableCredit({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn("text-2xs text-muted-foreground", className)}>
      {t("setup.credit")}{" "}
      <button
        type="button"
        className="cursor-default underline underline-offset-2 hover:text-foreground"
        onClick={() => (isTauri ? void openUrl("https://vb-audio.com/Cable/") : window.open("https://vb-audio.com/Cable/"))}
      >
        vb-audio.com
      </button>
    </p>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Notice({ tone = "warning", children }: { tone?: "warning" | "error"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl px-3.5 py-2.5 text-sm",
        tone === "warning" ? "bg-warning/12 text-warning-foreground" : "bg-error/10 text-error-foreground",
      )}
    >
      {children}
    </div>
  );
}

function CableStep() {
  const t = useT();
  const cable = useSetup((s) => s.cable);
  return (
    <div className="space-y-4">
      {cable.installed ? (
        <div className="flex items-center gap-3 rounded-xl bg-success/12 px-3.5 py-3 text-sm text-success-foreground">
          <Check className="size-4" /> {t("setup.cableInstalled")}
        </div>
      ) : cable.installing ? (
        <Progress label={cable.step ?? t("setup.starting")} value={cable.progress} />
      ) : (
        <Button onClick={() => setup.installCable()}>{t("setup.installCable")}</Button>
      )}
      {cable.error && <Notice tone="error">{cable.error}</Notice>}
      {cable.restartRecommended && !cable.installed && (
        <Notice>{t("setup.restartNeeded")}</Notice>
      )}
      {cable.defaultOutputIsCable && (
        <Notice>
          {t("setup.defaultIsCable")}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setup.openSoundSettings()}>
            {t("setup.openSoundSettings")}
          </Button>
        </Notice>
      )}
      <CableCredit />
    </div>
  );
}

function DevicesStep() {
  const t = useT();
  const devices = useStore((s) => s.devices);
  const config = useStore((s) => s.config);
  const options = (list: typeof devices.inputs) =>
    list.filter((d) => !d.isVirtualCable).map((d) => ({ value: d.id, label: d.name, hint: d.isDefault ? t("setup.default") : undefined }));

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="font-mono text-3xs text-muted-foreground uppercase">{t("setup.microphone")}</span>
        <Select value={config.inputId} onChange={(inputId) => actions.setConfig({ inputId })} options={options(devices.inputs)} />
      </label>
      <label className="block space-y-1.5">
        <span className="font-mono text-3xs text-muted-foreground uppercase">{t("setup.headphones")}</span>
        <Select
          value={config.monitorId ?? ""}
          onChange={(id) => actions.setConfig({ monitorId: id || null })}
          options={options(devices.outputs)}
          placeholder={t("setup.off")}
        />
      </label>
    </div>
  );
}

function DiscordStep() {
  const t = useT();
  return (
    <ol className="space-y-3 text-sm">
      <li className="flex gap-3">
        <span className="font-mono text-muted-foreground">1</span>
        <span>
          {t("setup.discord1")}{" "}
          <span className="font-medium">CABLE Output (VB-Audio Virtual Cable)</span>
        </span>
      </li>
      <li className="flex gap-3">
        <span className="font-mono text-muted-foreground">2</span>
        <span>{t("setup.discord2")}</span>
      </li>
      <li className="flex gap-3">
        <span className="font-mono text-muted-foreground">3</span>
        <span>{t("setup.discord3")}</span>
      </li>
    </ol>
  );
}

/** Beim ersten Start: Kabel, Geräte, Discord. Zeigt sich nur, solange die Einrichtung offen ist. */
export function SetupWizard() {
  const t = useT();
  const loaded = useSetup((s) => s.loaded);
  const done = useSetup((s) => s.settings.setupDone);
  const cable = useSetup((s) => s.cable);
  const [step, setStep] = useState(0);

  useEffect(() => {
    void setup.init();
  }, []);

  if (!loaded || done) return null;

  const last = step === STEPS.length - 1;
  const canContinue = step !== 0 || (cable.installed && !cable.installing);
  const finish = async () => {
    await setup.update({ setupDone: true });
    void actions.start();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div role="dialog" aria-label={t("setup.dialog")} className="relative w-full max-w-md rounded-3xl bg-popover p-6 shadow-[var(--shadow-pop)]">
        <div className="mb-4 font-display text-2xl leading-none font-semibold tracking-tight">ode</div>
        <div className="mb-5 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-[var(--meter-track)]")} />
          ))}
        </div>
        <h2 className="mb-4 font-display text-xl font-semibold tracking-tight">{t(STEPS[step])}</h2>

        {step === 0 && <CableStep />}
        {step === 1 && <DevicesStep />}
        {step === 2 && <DiscordStep />}

        <div className="mt-6 flex items-center gap-2">
          {step > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              {t("setup.back")}
            </Button>
          )}
          <div className="flex-1" />
          {step === 0 && !cable.installed && (
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              {t("setup.later")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!canContinue && !(step === 0 && !cable.installed)}
            onClick={() => (last ? void finish() : setStep(step + 1))}
            className={cn(step === 0 && !cable.installed && "hidden")}
          >
            {cable.installing && step === 0 && <Loader2 className="animate-spin" />}
            {last ? t("setup.done") : t("setup.next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
