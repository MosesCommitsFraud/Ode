import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowDown, Waveform as AudioWaveform, CaretLeft as ChevronLeft, CaretRight as ChevronRight, VinylRecord as Disc3, DownloadSimple as Download, Stack as Layers, LinkSimple as Link2, CircleNotch as Loader2, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type WheelEvent } from "react";
import { Button } from "~/components/ui/button";
import { Card, EmptyState, Kbd } from "~/components/ui/misc";
import { ACTIVE, downloads, useDownloads, type Job, type Target } from "~/lib/downloads";
import { isTauri } from "~/lib/engine";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { music } from "~/lib/music";
import { cn } from "~/lib/utils";

const ROW_HEIGHT = 60;

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

const CHOICE_LABEL: Record<Target, string> = { soundboard: "Soundboard", music: "Musik", both: "Beides" };

function isLink(text: string) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

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

const TARGET_OPTIONS: { value: Target; label: string; icon: ReactNode; color: string }[] = [
  { value: "soundboard", label: "Sound", icon: <AudioWaveform />, color: "var(--ch-soundboard)" },
  { value: "music", label: "Musik", icon: <Disc3 />, color: "var(--ch-music)" },
  { value: "both", label: "Beides", icon: <Layers />, color: "var(--primary)" },
];

/** Ziel als kleiner Umschalter mit gleitender Markierung in der Farbe des Ziels. */
function TargetPicker({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
  const index = Math.max(0, TARGET_OPTIONS.findIndex((o) => o.value === value));
  const current = TARGET_OPTIONS[index];
  return (
    <div
      role="radiogroup"
      aria-label="Ziel"
      style={{ "--pick": current.color } as CSSProperties}
      className="well relative grid h-10 shrink-0 grid-cols-3 rounded-xl p-1"
    >
      <span
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-panel-raised shadow-[0_1px_0_var(--hairline),0_4px_10px_-4px_oklch(0%_0_0/40%)] transition-transform duration-300 ease-drawer"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {TARGET_OPTIONS.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex cursor-default items-center justify-center gap-1.5 px-3 text-xs font-semibold transition-colors [&_svg]:size-3.5",
              on ? "text-foreground [&_svg]:text-[var(--pick)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Eine Zeile: Link, Ziel (eins oder beides) und Los. */
function AddForm() {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<Target>("soundboard");
  const [hint, setHint] = useState<string | null>(null);
  const error = useDownloads((s) => s.error);

  useEffect(() => input.current?.focus(), []);

  const valid = isLink(url);

  const submit = async () => {
    if (!valid) return;
    const clean = url.trim();
    await downloads.add(clean, target);
    setUrl("");
    input.current?.focus();
  };

  const paste = async () => {
    setHint(null);
    try {
      const text = (isTauri ? await readText() : await navigator.clipboard.readText()).trim();
      if (isLink(text)) setUrl(text);
      else setHint("In der Zwischenablage ist kein Link.");
    } catch {
      setHint("Zwischenablage nicht lesbar – Strg V geht auch.");
    }
    input.current?.focus();
  };

  return (
    <div>
      <div className="panel flex h-16 items-center gap-2 rounded-2xl pr-2.5 pl-5 focus-within:shadow-[var(--shadow-panel),0_0_0_2px_var(--ring)]">
        <Link2 className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Link von YouTube, SoundCloud, …"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {url ? (
          <button
            type="button"
            title="Leeren"
            onClick={() => {
              setUrl("");
              input.current?.focus();
            }}
            className="flex size-8 cursor-default items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
          >
            <X />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void paste()}
            className="flex h-8 cursor-default items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Einfügen <Kbd>Strg V</Kbd>
          </button>
        )}
        <span className="mx-1.5 h-6 w-px bg-border" />
        <TargetPicker value={target} onChange={setTarget} />
        <button
          type="button"
          title="Laden"
          disabled={!valid}
          onClick={() => void submit()}
          className="ml-1 flex size-11 shrink-0 cursor-default items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all active:scale-95 disabled:bg-muted disabled:text-muted-foreground [&_svg]:size-5"
        >
          <ArrowDown />
        </button>
      </div>
      {(hint || error) && <p className="mt-2 px-5 text-xs text-error-foreground">{hint ?? error}</p>}
    </div>
  );
}

/** Ziel einer fertigen Datei umschalten: Soundboard, Musik oder beides. */
function TargetToggle({ job }: { job: Job }) {
  const editable = job.status === "done";
  const current = job.target;
  const has = (t: Target) => current === t || current === "both";
  const toggle = (t: Target) => {
    const other: Target = t === "soundboard" ? "music" : "soundboard";
    const next: Target = has(t) ? (has(other) ? other : current) : has(other) ? "both" : t;
    if (next !== current) void downloads.setTarget(job.id, next);
  };

  return (
    <div className="flex gap-1">
      {(["soundboard", "music"] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={!editable}
          title={editable ? (has(t) ? `Aus ${CHOICE_LABEL[t]} entfernen` : `Zu ${CHOICE_LABEL[t]} hinzufügen`) : undefined}
          onClick={() => toggle(t)}
          className={cn(
            "h-6 cursor-default rounded-full px-2.5 font-mono text-3xs font-semibold uppercase transition-colors",
            has(t)
              ? t === "music"
                ? "bg-[color-mix(in_oklch,var(--ch-music)_16%,transparent)] text-[var(--ch-music)]"
                : "bg-[color-mix(in_oklch,var(--ch-soundboard)_16%,transparent)] text-[var(--ch-soundboard)]"
              : "text-muted-foreground/60",
            editable && !has(t) && "hover:bg-accent hover:text-foreground",
          )}
        >
          {CHOICE_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

function Thumb({ job }: { job: Job }) {
  const [failed, setFailed] = useState(false);
  const src = job.cover && isTauri ? convertFileSrc(job.cover) : null;
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground shadow-[0_0_0_1px_var(--hairline)] [&_svg]:size-4">
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <Download />
      )}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const active = ACTIVE.includes(job.status);
  const label = job.status === "downloading" || job.status === "converting"
    ? `${STATUS[job.status]} ${Math.round(job.progress * 100)} %`
    : STATUS[job.status];

  return (
    <div className="grid h-full grid-cols-[2.5rem_1fr_auto_9rem_2rem] items-center gap-4 rounded-xl px-3 hover:bg-accent">
      <Thumb job={job} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{job.title ?? job.url}</div>
        <div className={cn("truncate text-2xs", job.error ? "text-error-foreground" : "text-muted-foreground")}>
          {job.error ?? (job.artist ? `${job.artist} · ${job.url}` : job.title ? job.url : "")}
        </div>
      </div>
      <TargetToggle job={job} />
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
    <div className="flex h-full flex-col gap-4 pl-6 pr-3 pt-3 pb-4">
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
            <EmptyState art="downloads" title="Die Kiste ist leer">
              Link oben rein, den Rest macht Ode.
            </EmptyState>
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
