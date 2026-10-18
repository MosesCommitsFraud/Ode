import { Keyboard, Play, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { Kbd, SectionLabel, Segmented } from "~/components/ui/misc";
import { library, SOUND_COLORS, soundColor, type PlayMode, type Sound } from "~/lib/library";
import { useStore } from "~/lib/store";
import { cn, formatDb } from "~/lib/utils";
import { hotkeyFromEvent, hotkeyLabel } from "./hotkey";
import { Waveform } from "./Waveform";

const MODES: PlayMode[] = ["restart", "overlap", "toggle"];
const MODE_LABELS: Record<PlayMode, string> = {
  restart: "Neustart",
  overlap: "Überlagern",
  toggle: "Stopp",
};
const MODE_HINTS: Record<PlayMode, string> = {
  restart: "Erneutes Drücken startet den Sound von vorn.",
  overlap: "Erneutes Drücken spielt ihn zusätzlich, mehrere laufen gleichzeitig.",
  toggle: "Erneutes Drücken stoppt den laufenden Sound.",
};

function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{label}</SectionLabel>
        {aside && <span className="font-mono text-3xs text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Range({
  value,
  min,
  max,
  step,
  onChange,
  color,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-default appearance-none rounded-full bg-[var(--meter-track)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_oklch(0%_0_0/40%)]"
      style={{
        background: `linear-gradient(to right, ${color} ${((value - min) / (max - min)) * 100}%, var(--meter-track) 0)`,
      }}
    />
  );
}

function HotkeyRecorder({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return setRecording(false);
      const hotkey = hotkeyFromEvent(e);
      if (hotkey) {
        onChange(hotkey);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRecording((r) => !r)}
        className={cn(
          "well flex h-10 flex-1 cursor-default items-center gap-2 rounded-xl px-3 text-left text-sm transition-shadow",
          recording && "shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        <Keyboard className="size-4 text-muted-foreground" />
        {recording ? (
          <span className="text-primary">Tastenkombination drücken … (Esc bricht ab)</span>
        ) : value ? (
          <span className="flex gap-1">
            {hotkeyLabel(value).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">Klicken und Taste drücken</span>
        )}
      </button>
      {value && !recording && (
        <Button variant="ghost" size="icon-sm" title="Hotkey entfernen" onClick={() => onChange(null)}>
          <X />
        </Button>
      )}
    </div>
  );
}

export function SoundEditor({
  sound,
  categories,
  onClose,
}: {
  sound: Sound;
  categories: string[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(sound);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = soundColor(draft.color);
  const duration = Math.max(1, draft.durationMs);
  const trimEnd = draft.trimEndMs || duration;
  // Abspielposition des zuletzt gestarteten Durchlaufs dieses Sounds.
  const progress = useStore((s) => s.meters?.playing.filter((p) => p.id === sound.id).at(-1)?.progress);
  const positionMs =
    progress === undefined ? undefined : draft.trimStartMs + progress * (trimEnd - draft.trimStartMs);

  const patch = (p: Partial<Sound>) => setDraft((d) => ({ ...d, ...p }));

  const save = async () => {
    await library.update(sound.id, {
      name: draft.name.trim() || sound.name,
      color: draft.color,
      hotkey: draft.hotkey,
      volumeDb: draft.volumeDb,
      category: draft.category?.trim() || null,
      playMode: draft.playMode,
      trimStartMs: draft.trimStartMs,
      trimEndMs: trimEnd >= duration ? 0 : trimEnd,
      fadeInMs: draft.fadeInMs,
      fadeOutMs: draft.fadeOutMs,
    });
  };

  const close = async () => {
    await save();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => void close()} />
      <div
        role="dialog"
        aria-label={`${sound.name} bearbeiten`}
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-popover shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="min-w-0 flex-1 bg-transparent font-display text-xl font-semibold tracking-tight outline-none"
            aria-label="Name"
          />
          <Button variant="ghost" size="icon-sm" title="Schließen" onClick={() => void close()}>
            <X />
          </Button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 pb-5">
          <Field
            label="Trimmen"
            aside={
              positionMs !== undefined
                ? `▶ ${(positionMs / 1000).toFixed(2)} s`
                : `${(draft.trimStartMs / 1000).toFixed(2)} – ${(trimEnd / 1000).toFixed(2)} s`
            }
          >
            <div className="well rounded-xl p-3">
              <Waveform
                peaks={draft.waveform}
                color={color}
                progress={progress}
                className="h-20"
                trim={{
                  start: draft.trimStartMs / duration,
                  end: trimEnd / duration,
                  onChange: (s, e) =>
                    patch({ trimStartMs: Math.round(s * duration), trimEndMs: Math.round(e * duration) }),
                }}
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Einblenden" aside={`${draft.fadeInMs} ms`}>
              <Range value={draft.fadeInMs} min={0} max={2000} step={10} color={color} onChange={(v) => patch({ fadeInMs: v })} />
            </Field>
            <Field label="Ausblenden" aside={`${draft.fadeOutMs} ms`}>
              <Range value={draft.fadeOutMs} min={0} max={2000} step={10} color={color} onChange={(v) => patch({ fadeOutMs: v })} />
            </Field>
          </div>

          <Field label="Lautstärke" aside={`${formatDb(draft.volumeDb)} dB`}>
            <Range value={draft.volumeDb} min={-30} max={12} step={0.5} color={color} onChange={(v) => patch({ volumeDb: v })} />
          </Field>

          <Field label="Hotkey">
            <HotkeyRecorder value={draft.hotkey} onChange={(hotkey) => patch({ hotkey })} />
          </Field>

          <Field label="Erneut drücken">
            <Segmented value={draft.playMode} onChange={(playMode) => patch({ playMode })} options={MODES} format={(m) => MODE_LABELS[m]} />
            <p className="text-xs text-muted-foreground">{MODE_HINTS[draft.playMode]}</p>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Kategorie">
              <input
                value={draft.category ?? ""}
                onChange={(e) => patch({ category: e.target.value })}
                list="ode-categories"
                placeholder="Keine"
                className="well h-10 w-full rounded-xl px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="ode-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Farbe">
              <div className="flex h-10 flex-wrap items-center gap-1.5">
                {Object.entries(SOUND_COLORS).map(([name, value]) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => patch({ color: name })}
                    className={cn(
                      "h-6 w-7 cursor-default rounded-lg transition-transform hover:scale-110",
                      draft.color === name && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
                    )}
                    style={{ background: value }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size="sm"
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              void library.remove(sound.id);
              onClose();
            }}
          >
            <Trash2 /> {confirmDelete ? "Wirklich löschen?" : "Löschen"}
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await save();
              void library.play(sound.id);
            }}
          >
            <Play /> Anhören
          </Button>
          <Button size="sm" onClick={() => void close()}>
            Fertig
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
