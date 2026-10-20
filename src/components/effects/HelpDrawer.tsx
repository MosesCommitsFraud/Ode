import { Question, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { Engraved } from "~/components/ui/hardware";
import { Pill, PillGroup } from "~/components/ui/pills";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/* Erklärung der Werkzeuge: ein „?“ am Titel jedes Geräts öffnet ein Panel
   mit dem, was es tut, wann man es braucht und was die Regler bewirken.
   Texte in i18n/help.ts. */

/** Werkzeug-ID → Schlüssel des Titels, wie er auf der Seite steht. */
const TITLES: Record<string, string> = {
  aec: "effects.aec",
  gate: "effects.gate",
  denoise: "effects.denoise",
  eq: "effects.eq",
  agc: "effects.agc",
  compressor: "effects.compressor",
  deEsser: "effects.deEsser",
  exciter: "effects.exciter",
  limiter: "effects.limiter",
  presets: "voice.presets",
  pitch: "voice.pitch",
  autotune: "voice.autotune",
  harmonizer: "voice.harmonizer",
  vocoder: "voice.vocoder",
  character: "voice.character",
  modulation: "voice.modulation",
  echo: "voice.echo",
  reverb: "voice.reverb",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <Engraved>{label}</Engraved>
      {children}
    </section>
  );
}

function Panel({ topics, onClose }: { topics: string[]; onClose: () => void }) {
  const [topic, setTopic] = useState(topics[0]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const controls = t(`help.${topic}.controls`)
    .split("\n")
    .map((line) => {
      const at = line.indexOf(": ");
      return at > 0 ? { name: line.slice(0, at), text: line.slice(at + 2) } : { name: "", text: line };
    });

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end p-2">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={t("help.title")}
        className="relative flex h-full w-[min(520px,94vw)] animate-[layout-in_220ms_var(--ease-drawer)] flex-col overflow-hidden rounded-3xl bg-popover shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <h2 className="flex-1 font-display text-xl font-semibold tracking-tight">{t("help.title")}</h2>
          <Button variant="ghost" size="icon-sm" title={t("help.close")} onClick={onClose}>
            <X />
          </Button>
        </div>
        {topics.length > 1 && (
          <div className="px-6 pb-4">
            <PillGroup className="w-fit max-w-full">
              {topics.map((id) => (
                <Pill key={id} active={id === topic} onClick={() => setTopic(id)} className="px-2.5">
                  {t(TITLES[id])}
                </Pill>
              ))}
            </PillGroup>
          </div>
        )}
        <div key={topic} className="min-h-0 flex-1 animate-[layout-in_200ms_var(--ease-drawer)] space-y-5 overflow-y-auto px-6 pb-6">
          <h3 className="font-display text-2xl font-semibold tracking-tight">{t(TITLES[topic])}</h3>
          <Section label={t("help.what")}>
            <p className="text-sm leading-relaxed">{t(`help.${topic}.what`)}</p>
          </Section>
          <Section label={t("help.when")}>
            <p className="text-sm leading-relaxed">{t(`help.${topic}.when`)}</p>
          </Section>
          <Section label={t("help.controls")}>
            <dl className="well space-y-2.5 rounded-xl p-4 text-sm leading-relaxed">
              {controls.map((c, i) => (
                <div key={i}>
                  {c.name && <dt className="font-semibold">{c.name}</dt>}
                  <dd className="text-muted-foreground">{c.text}</dd>
                </div>
              ))}
            </dl>
          </Section>
          {TITLES[topic].startsWith("effects.") && <p className="font-mono text-2xs leading-relaxed text-muted-foreground">{t("help.order")}</p>}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** Kleines „?“ neben einem Titel: erklärt genau dieses Werkzeug. */
export function HelpIcon({ topic, className }: { topic: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={t("help.button")}
        aria-label={t("help.button")}
        onClick={() => setOpen(true)}
        className={cn(
          "flex size-6 shrink-0 cursor-default items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4",
          className,
        )}
      >
        <Question weight="bold" />
      </button>
      {open && <Panel topics={[topic]} onClose={() => setOpen(false)} />}
    </>
  );
}
