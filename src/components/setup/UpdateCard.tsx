import { ArrowsClockwise, CircleNotch, DownloadSimple } from "@phosphor-icons/react";
import { useEffect } from "react";
import { ActionGroup, ActionPill } from "~/components/ui/pills";
import { Card } from "~/components/ui/misc";
import { updater, useUpdater } from "~/lib/updater";
import { cn } from "~/lib/utils";

function since(time: number | null) {
  if (!time) return null;
  const minutes = Math.round((Date.now() - time) / 60000);
  return minutes < 1 ? "gerade eben" : minutes === 1 ? "vor 1 Minute" : `vor ${minutes} Minuten`;
}

/** Version und Updates aus den GitHub-Releases. */
export function UpdateCard() {
  const version = useUpdater((s) => s.version);
  const status = useUpdater((s) => s.status);
  const available = useUpdater((s) => s.available);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const checkedAt = useUpdater((s) => s.checkedAt);

  useEffect(() => {
    void updater.init();
  }, []);

  const busy = status === "checking" || status === "downloading" || status === "ready";

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Version</h2>
        <span className="font-mono text-sm tabular-nums">{version ?? "–"}</span>
      </div>

      {available && status !== "current" ? (
        <div className="mt-3 rounded-xl bg-primary/10 p-3">
          <div className="text-sm font-semibold">Version {available.version} ist da</div>
          {available.notes && (
            <p className="mt-1 line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">{available.notes}</p>
          )}
          {status === "downloading" || status === "ready" ? (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-2xs text-muted-foreground">
                <span>{status === "ready" ? "Startet neu …" : "Lädt herunter …"}</span>
                {progress !== null && <span className="font-mono tabular-nums">{Math.round(progress * 100)} %</span>}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
                <div
                  className={cn("h-full rounded-full bg-primary transition-[width]", progress === null && "w-1/3 animate-pulse")}
                  style={progress === null ? undefined : { width: `${progress * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <ActionGroup className="mt-3 w-fit">
              <ActionPill primary onClick={() => void updater.install()}>
                <DownloadSimple /> Jetzt aktualisieren
              </ActionPill>
            </ActionGroup>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {status === "checking"
            ? "Sucht nach Updates …"
            : status === "current"
              ? `Aktuell · geprüft ${since(checkedAt)}`
              : status === "error"
                ? null
                : null}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-error-foreground">{error}</p>}

      <ActionGroup className="mt-3 w-fit">
        <ActionPill disabled={busy} onClick={() => void updater.check()}>
          {status === "checking" ? <CircleNotch className="animate-spin" /> : <ArrowsClockwise />}
          Nach Updates suchen
        </ActionPill>
      </ActionGroup>
    </Card>
  );
}
