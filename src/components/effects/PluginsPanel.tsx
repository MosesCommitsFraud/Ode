import { AppWindow, ArrowClockwise, CaretLeft, CaretRight, FolderOpen, MagnifyingGlass, Plug, Trash, Warning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { PushButton } from "~/components/ui/hardware";
import { Knob } from "~/components/ui/knob";
import { Card, EmptyState } from "~/components/ui/misc";
import { ActionGroup, ActionPill } from "~/components/ui/pills";
import { t } from "~/lib/i18n";
import { plugins, usePlugins, type ParamDesc } from "~/lib/plugins";
import { cn } from "~/lib/utils";

/* Plugin-Slot: ein CLAP-Plugin nach den Stimm-Effekten, vor dem Limiter.
   Parameter erscheinen als Drehregler, das eigene Fenster des Plugins lässt
   sich daneben öffnen. */

/** Wie viele Zellen einer Größe in den Bereich passen; für Seiten statt Scrollen. */
function useFit(cell: { width: number; height: number }, gap: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ cols: 6, rows: 2 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFit({
        cols: Math.max(1, Math.floor((width + gap) / (cell.width + gap))),
        rows: Math.max(1, Math.floor((height + gap) / (cell.height + gap))),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cell.width, cell.height, gap]);
  return { ref, ...fit };
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return <div className="h-9" />;
  return (
    <div className="flex h-9 items-center justify-center gap-3">
      <Button variant="ghost" size="icon-sm" title={t("common.previousPage")} disabled={page === 0} onClick={() => onPage(page - 1)}>
        <CaretLeft />
      </Button>
      <span className="font-mono text-2xs text-muted-foreground tabular-nums">{t("common.page", { current: page + 1, pages })}</span>
      <Button variant="ghost" size="icon-sm" title={t("common.nextPage")} disabled={page === pages - 1} onClick={() => onPage(page + 1)}>
        <CaretRight />
      </Button>
    </div>
  );
}

function usePaged<T>(items: T[], perPage: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / Math.max(1, perPage)));
  const current = Math.min(page, pages - 1);
  return { page: current, pages, setPage, shown: items.slice(current * perPage, (current + 1) * perPage) };
}

const ROW = 52;

/** Liste gefundener Plugins, solange der Slot leer ist. */
function Browser() {
  const found = usePlugins((s) => s.found);
  const scanning = usePlugins((s) => s.scanning);
  const busy = usePlugins((s) => s.busy);
  const [searched, setSearched] = useState(false);
  const fit = useFit({ width: 1, height: ROW }, 6);
  const paged = usePaged(found, fit.rows);

  const search = async () => {
    await plugins.scan();
    setSearched(true);
  };

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 font-display text-base font-semibold tracking-tight">{t("plugins.emptyTitle")}</h3>
        <ActionGroup>
          <ActionPill onClick={() => void plugins.pickFile()}>
            <FolderOpen /> {t("plugins.pickFile")}
          </ActionPill>
          <ActionPill primary disabled={scanning} onClick={() => void search()}>
            <MagnifyingGlass /> {scanning ? t("plugins.searching") : t("plugins.search")}
          </ActionPill>
        </ActionGroup>
      </div>
      <div ref={fit.ref} className="min-h-0 flex-1 overflow-hidden">
        {found.length === 0 ? (
          <EmptyState icon={<Plug weight="duotone" />} title={searched ? t("plugins.nothingFound") : t("plugins.emptyTitle")}>
            {t("plugins.emptyHint")}
          </EmptyState>
        ) : (
          <div className="grid gap-1.5" style={{ gridAutoRows: ROW }}>
            {paged.shown.map((p) => (
              <div key={`${p.path}:${p.id}`} className="well flex items-center gap-3 rounded-xl px-4">
                <Plug className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="truncate font-mono text-3xs text-muted-foreground" title={p.path}>
                    {[p.vendor, p.version].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button size="sm" disabled={busy} onClick={() => void plugins.load(p)}>
                  {t("plugins.load")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} />
    </Card>
  );
}

function ParamKnob({ param }: { param: ParamDesc }) {
  const range = param.max - param.min;
  return (
    <Knob
      label={param.name}
      value={param.value}
      min={param.min}
      max={param.max}
      step={param.stepped ? 1 : range / 200 || 0.01}
      reset={param.default}
      ticks={param.stepped ? Math.min(25, Math.round(range) + 1) : 11}
      format={(v) => (param.text && v === param.value ? param.text : param.stepped ? String(Math.round(v)) : v.toFixed(range > 10 ? 1 : 2))}
      onChange={(v) => plugins.setParam(param.id, v)}
    />
  );
}

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-right leading-tight">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="font-mono text-2xs tabular-nums">{children}</div>
    </div>
  );
}

/** Das geladene Plugin: Kopf mit Schaltern, darunter die Parameter. */
function Rack() {
  const status = usePlugins((s) => s.status);
  const params = usePlugins((s) => s.params);
  const fit = useFit({ width: 84, height: 92 }, 8);
  const paged = usePaged(params, fit.cols * fit.rows);
  const info = status.loaded!;

  // Rechenzeit und Fensterzustand nachführen; Werte aus dem Plugin-Fenster nachladen.
  useEffect(() => {
    const id = window.setInterval(() => void plugins.refresh(), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-4">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", status.bypass ? "well text-muted-foreground" : "bg-primary text-primary-foreground")}>
          <Plug weight={status.bypass ? "bold" : "fill"} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold tracking-tight">{info.name}</h3>
          <div className="truncate font-mono text-3xs text-muted-foreground" title={info.path}>
            {[info.vendor, info.version].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Readout label={t("plugins.latency")}>{status.latencyMs.toFixed(1)} ms</Readout>
        <Readout label={t("plugins.cpu")}>{status.loadMs.toFixed(2)} ms</Readout>
        <div className="w-20">
          <PushButton label={t("plugins.bypass")} on={status.bypass} onChange={(on) => void plugins.setBypass(on)} />
        </div>
        <ActionGroup>
          {status.hasGui && (
            <ActionPill onClick={() => void plugins.gui(!status.guiOpen)}>
              <AppWindow /> {status.guiOpen ? t("plugins.closeWindow") : t("plugins.openWindow")}
            </ActionPill>
          )}
          <ActionPill onClick={() => void plugins.unload()}>
            <Trash /> {t("plugins.remove")}
          </ActionPill>
        </ActionGroup>
      </div>
      <div ref={fit.ref} className={cn("well min-h-0 flex-1 overflow-hidden rounded-xl p-3 transition-opacity", status.bypass && "opacity-50")}>
        {params.length === 0 ? (
          <p className="pt-10 text-center text-sm text-muted-foreground">{t("plugins.noParams")}</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridAutoRows: 92 }}>
            {paged.shown.map((p) => (
              <ParamKnob key={p.id} param={p} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1 font-mono text-3xs text-muted-foreground">{t("plugins.separate")}</span>
        <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} />
        <span className="flex-1" />
      </div>
    </Card>
  );
}

/** Meldung nach einem Absturz oder Hänger des Plugin-Prozesses. */
function Crashed({ message }: { message: string }) {
  const last = usePlugins((s) => s.status.last);
  const busy = usePlugins((s) => s.busy);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-warning/12 px-4 py-2.5 text-sm text-warning-foreground">
      <Warning weight="fill" className="size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {last && (
        <Button size="sm" disabled={busy} onClick={() => void plugins.reload()}>
          <ArrowClockwise /> {t("plugins.reload")}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => void plugins.unload()}>
        {t("plugins.dismiss")}
      </Button>
    </div>
  );
}

export function PluginsPanel() {
  const loaded = usePlugins((s) => s.status.loaded !== null);
  const crashed = usePlugins((s) => s.status.crashed);
  const error = usePlugins((s) => s.error);

  // Einen Absturz auch dann bemerken, wenn der Slot leer aussieht.
  useEffect(() => {
    if (loaded) return;
    const id = window.setInterval(() => void plugins.refresh(), 2000);
    return () => window.clearInterval(id);
  }, [loaded]);
  return (
    <div className="flex min-h-0 flex-1 animate-[layout-in_260ms_var(--ease-drawer)] flex-col gap-3 pr-3 pb-3 pl-6">
      {error && (
        <div className="flex items-center gap-3 rounded-2xl bg-error/10 px-4 py-2 text-sm text-error-foreground">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => plugins.dismissError()} className="cursor-default opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {crashed && <Crashed message={crashed} />}
      {loaded ? <Rack /> : <Browser />}
    </div>
  );
}

