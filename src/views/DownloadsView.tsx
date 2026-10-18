import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type WheelEvent } from "react";
import { Button } from "~/components/ui/button";
import { Card, EmptyState, Segmented } from "~/components/ui/misc";
import { Select } from "~/components/ui/select";
import { ACTIVE, downloads, useDownloads, type Job, type Target } from "~/lib/downloads";
import { music, useMusic } from "~/lib/music";
import { cn } from "~/lib/utils";

const ROW_HEIGHT = 56;

const STATUS: Record<Job["status"], string> = {
  queued: "Wartet",
  info: "Infos",
  downloading: "Lädt",
  converting: "Wandelt",
  importing: "Importiert",
  done: "Fertig",
  failed: "Fehler",
  cancelled: "Abgebrochen",
};

const TARGETS: Target[] = ["soundboard", "music"];
const TARGET_LABEL: Record<Target, string> = { soundboard: "Soundboard", music: "Musik" };

function useRowCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setRows(Math.max(1, Math.floor(entry.contentRect.height / ROW_HEIGHT))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, rows };
}

function ToolsSetup() {
  const tools = useDownloads((s) => s.tools);
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">yt-dlp und FFmpeg fehlen</h2>
        {tools.installing ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between font-mono text-3xs text-muted-foreground uppercase">
              <span>{tools.step ?? "Startet …"}</span>
              <span className="tabular-nums">{Math.round(tools.progress * 100)} %</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${tools.progress * 100}%` }} />
            </div>
          </div>
        ) : (
          tools.error && <p className="mt-1 text-sm text-error-foreground">{tools.error}</p>
        )}
      </div>
      <Button disabled={tools.installing} onClick={() => downloads.installTools()}>
        {tools.installing && <Loader2 className="animate-spin" />}
        Installieren · 100 MB
      </Button>
    </Card>
  );
}

function AddForm() {
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<Target>("soundboard");
  const [playlist, setPlaylist] = useState("");
  const playlists = useMusic((s) => s.playlists);
  const error = useDownloads((s) => s.error);

  const submit = async () => {
    if (!url.trim()) return;
    await downloads.add(url.trim(), target, target === "music" && playlist ? Number(playlist) : null);
    setUrl("");
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Link einfügen – YouTube, SoundCloud, …"
          className="well h-11 min-w-0 flex-1 rounded-xl px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="w-60 shrink-0">
          <Segmented value={target} options={TARGETS} onChange={setTarget} format={(t) => TARGET_LABEL[t]} />
        </div>
        {target === "music" && (
          <Select
            className="w-48 shrink-0"
            value={playlist}
            onChange={setPlaylist}
            placeholder="Keine Playlist"
            options={playlists.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        )}
        <Button disabled={!url.trim()} onClick={() => void submit()}>
          Laden
        </Button>
      </div>
      {error && <p className="mt-2 px-1 text-sm text-error-foreground">{error}</p>}
    </Card>
  );
}

function JobRow({ job }: { job: Job }) {
  const active = ACTIVE.includes(job.status);
  const label = job.status === "downloading" || job.status === "converting"
    ? `${STATUS[job.status]} ${Math.round(job.progress * 100)} %`
    : STATUS[job.status];

  return (
    <div className="grid h-full grid-cols-[1fr_7rem_9rem_2rem] items-center gap-4 rounded-xl px-3 hover:bg-accent">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{job.title ?? job.url}</div>
        <div className={cn("truncate text-2xs", job.error ? "text-error-foreground" : "text-muted-foreground")}>
          {job.error ?? (job.artist ? `${job.artist} · ${job.url}` : job.title ? job.url : "")}
        </div>
      </div>
      <span className="font-mono text-3xs text-muted-foreground uppercase">{TARGET_LABEL[job.target]}</span>
      <div className="space-y-1">
        <div
          className={cn(
            "font-mono text-3xs uppercase tabular-nums",
            job.status === "done" && "text-success-foreground",
            job.status === "failed" && "text-error-foreground",
            (job.status === "cancelled" || job.status === "queued") && "text-muted-foreground",
          )}
        >
          {label}
        </div>
        {active && (
          <div className="h-1 overflow-hidden rounded-full bg-[var(--meter-track)]">
            <div
              className={cn("h-full rounded-full bg-primary transition-[width]", job.status === "info" && "w-1/4 animate-pulse")}
              style={job.status === "info" ? undefined : { width: `${job.progress * 100}%` }}
            />
          </div>
        )}
      </div>
      {active ? (
        <Button variant="ghost" size="icon-sm" title="Abbrechen" onClick={() => downloads.cancel(job.id)}>
          <X />
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function DownloadsView() {
  const tools = useDownloads((s) => s.tools);
  const jobs = useDownloads((s) => s.jobs);
  const [page, setPage] = useState(0);
  const { ref, rows } = useRowCount();

  useEffect(() => {
    void downloads.init();
    void music.init();
  }, []);

  const ready = tools.ytDlp !== null && tools.ffmpeg;
  const list = [...jobs].reverse();
  const pages = Math.max(1, Math.ceil(list.length / rows));
  const current = Math.min(page, pages - 1);
  const shown = list.slice(current * rows, (current + 1) * rows);
  const finished = jobs.some((j) => !ACTIVE.includes(j.status));
  const turn = (delta: number) => setPage(Math.min(pages - 1, Math.max(0, current + delta)));
  const onWheel = (e: WheelEvent) => {
    if (pages > 1 && Math.abs(e.deltaY) > 20) turn(e.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="flex h-full flex-col gap-4 px-6 pt-5 pb-4">
      {ready ? <AddForm /> : <ToolsSetup />}

      <Card className="flex min-h-0 flex-1 flex-col p-3">
        <div className="flex h-9 items-center justify-between px-2 pb-1">
          <span className="font-mono text-3xs text-muted-foreground uppercase">Warteschlange · {jobs.length}</span>
          {finished && (
            <Button variant="ghost" size="sm" onClick={() => downloads.clearFinished()}>
              Erledigte entfernen
            </Button>
          )}
        </div>
        <div ref={ref} onWheel={onWheel} className="min-h-0 flex-1 overflow-hidden">
          {jobs.length === 0 ? (
            <EmptyState icon={<Download />} title="Keine Downloads" />
          ) : (
            <div className="grid" style={{ gridAutoRows: ROW_HEIGHT }}>
              {shown.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
        {pages > 1 && (
          <div className="flex h-9 shrink-0 items-center justify-center gap-3">
            <Button variant="ghost" size="icon-sm" title="Vorherige Seite" disabled={current === 0} onClick={() => turn(-1)}>
              <ChevronLeft />
            </Button>
            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
              Seite {current + 1} / {pages}
            </span>
            <Button variant="ghost" size="icon-sm" title="Nächste Seite" disabled={current === pages - 1} onClick={() => turn(1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
