import { Play, Stop, X } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import { Kbd, SectionLabel, Segmented } from "~/components/ui/misc";
import { library, SOUND_COLORS, soundColor, type PlayMode, type Sound } from "~/lib/library";
import { useStore } from "~/lib/store";
import { cn, formatDb } from "~/lib/utils";
import { heldModifiers, hotkeyFromEvent, hotkeyLabel } from "./hotkey";
import { Waveform } from "./Waveform";

const MODES: PlayMode[] = ["restart", "overlap", "toggle"];
const MODE_LABELS: Record<PlayMode, string> = {
  restart: "Neustart",
  overlap: "Überlagern",
  toggle: "Stopp",
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

function HotkeyRecorder({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | null;
  onChange: (hotkey: string | null, label: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  // Gerade gehaltene Modifier, damit man sieht, dass die Kombination ankommt.
  const [held, setHeld] = useState<string[]>([]);

  useEffect(() => {
    if (!recording) return;
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const recorded = hotkeyFromEvent(e);
      if (recorded) {
        onChange(recorded.hotkey, recorded.label);
        setRecording(false);
      } else {
        setHeld(heldModifiers(e));
      }
    };
    const onUp = (e: KeyboardEvent) => setHeld(heldModifiers(e));
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      setHeld([]);
    };
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRecording((r) => !r)}
        className={cn(
          "well flex h-10 flex-1 cursor-default items-center gap-1.5 rounded-xl px-3 text-left text-sm transition-shadow",
          recording && "shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        {recording ? (
          <>
            {hotkeyLabel(held.join("+")).filter(Boolean).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
            <Kbd className="animate-pulse">…</Kbd>
            <span className="ml-auto text-2xs text-muted-foreground">
              <Kbd>Esc</Kbd>
            </span>
          </>
        ) : value ? (
          hotkeyLabel(value, label).map((k, i) => <Kbd key={`${i}-${k}`}>{k}</Kbd>)
        ) : (
          <Kbd className="opacity-60">…</Kbd>
        )}
      </button>
      {value && !recording && (
        <Button variant="ghost" size="icon-sm" title="Hotkey entfernen" onClick={() => onChange(null, null)}>
          <X />
        </Button>
      )}
    </div>
  );
}

/** Ein- und Ausblenden als Rampen über der Wellenform (Anteile 0–1 der ganzen Länge). */
function FadeOverlay({ start, end, fadeIn, fadeOut, color }: { start: number; end: number; fadeIn: number; fadeOut: number; color: string }) {
  const length = Math.max(0, end - start);
  const fi = Math.min(fadeIn, length) * 100;
  const fo = Math.min(fadeOut, length) * 100;
  const s = start * 100;
  const e = end * 100;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
      {fi > 0 && (
        <>
          <polygon points={`${s},0 ${s + fi},0 ${s},100`} fill="var(--popover)" opacity="0.7" />
          <line x1={s} y1={100} x2={s + fi} y2={0} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {fo > 0 && (
        <>
          <polygon points={`${e - fo},0 ${e},0 ${e},100`} fill="var(--popover)" opacity="0.7" />
          <line x1={e - fo} y1={0} x2={e} y2={100} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
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
      hotkeyLabel: draft.hotkeyLabel,
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
            <div className="well flex items-center gap-3 rounded-xl p-3">
              {/* Vorhören nur auf dem Kopfhörer, nicht im virtuellen Mikrofon. */}
              <button
                type="button"
                title={progress !== undefined ? "Stoppen" : "Anhören (nur Kopfhörer)"}
                onClick={async () => {
                  if (progress !== undefined) return void library.stop(sound.id);
                  await save();
                  void library.preview(sound.id);
                }}
                className="flex size-10 shrink-0 cursor-default items-center justify-center rounded-full text-black/80 transition-transform active:scale-95 [&_svg]:size-4"
                style={{ background: color }}
              >
                {progress !== undefined ? <Stop weight="fill" /> : <Play weight="fill" className="translate-x-px" />}
              </button>
              <div className="relative h-20 min-w-0 flex-1">
                <Waveform
                  peaks={draft.waveform}
                  color={color}
                  progress={progress}
                  className="absolute inset-0"
                  trim={{
                    start: draft.trimStartMs / duration,
                    end: trimEnd / duration,
                    onChange: (s, e) =>
                      patch({ trimStartMs: Math.round(s * duration), trimEndMs: Math.round(e * duration) }),
                  }}
                />
                <FadeOverlay
                  start={draft.trimStartMs / duration}
                  end={trimEnd / duration}
                  fadeIn={draft.fadeInMs / duration}
                  fadeOut={draft.fadeOutMs / duration}
                  color={color}
                />
              </div>
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
            <HotkeyRecorder
              value={draft.hotkey}
              label={draft.hotkeyLabel}
              onChange={(hotkey, hotkeyLabel) => patch({ hotkey, hotkeyLabel })}
            />
          </Field>

          <Field label="Erneut drücken">
            <Segmented value={draft.playMode} onChange={(playMode) => patch({ playMode })} options={MODES} format={(m) => MODE_LABELS[m]} />
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
            {confirmDelete ? "Wirklich löschen?" : "Löschen"}
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => void close()}>
            Fertig
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
