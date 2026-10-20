import { CaretDown, CaretUp, PencilSimple, Prohibit, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HotkeyRecorder } from "~/components/soundboard/HotkeyRecorder";
import { hotkeyLabel } from "~/components/soundboard/hotkey";
import { Button } from "~/components/ui/button";
import { SectionLabel } from "~/components/ui/misc";
import type { Preset, VoiceParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
import { SOUND_COLORS, soundColor } from "~/lib/library";
import { actions, useStore } from "~/lib/store";
import { cn } from "~/lib/utils";
import { PRESET_ICONS, PresetIcon } from "./icons";

export function presetName(p: Preset) {
  return p.name || t(`voice.preset.${p.id}`);
}

/** Gleiche Stimm-Einstellung, unabhängig vom Hauptschalter. */
export function sameVoice(a: VoiceParams, b: VoiceParams) {
  return JSON.stringify({ ...a, enabled: true }) === JSON.stringify({ ...b, enabled: true });
}

/** Name, Symbol und Hotkey eines Presets; „überschreiben“ nimmt die aktuelle Einstellung. */
export function PresetEditor({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const voice = useStore((s) => s.effects.voice);
  const [draft, setDraft] = useState(() => ({ ...preset, name: presetName(preset) }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overwritten, setOverwritten] = useState(false);
  const patch = (p: Partial<Preset>) => setDraft((d) => ({ ...d, ...p }));

  const close = async () => {
    const name = draft.name.trim();
    // Mitgelieferte behalten ihren übersetzten Namen, solange er nicht geändert wurde.
    const keepsDefault = preset.builtin && !preset.name && name === presetName(preset);
    await actions.savePreset({ ...draft, name: keepsDefault ? "" : name || presetName(preset) });
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
        aria-label={t("voice.editPreset")}
        className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl bg-popover shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-black/80 [&_svg]:size-5"
            style={{ background: soundColor(draft.color) }}
          >
            <PresetIcon name={draft.icon} weight="fill" />
          </div>
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="min-w-0 flex-1 bg-transparent font-display text-xl font-semibold tracking-tight outline-none"
            aria-label={t("voice.name")}
            autoFocus
          />
          <Button variant="ghost" size="icon-sm" title={t("voice.done")} onClick={() => void close()}>
            <X />
          </Button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 pb-5">
          <div className="space-y-2">
            <SectionLabel>{t("voice.icon")}</SectionLabel>
            <div className="grid grid-cols-11 gap-1">
              {Object.keys(PRESET_ICONS).map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => patch({ icon: name })}
                  className={cn(
                    "flex aspect-square cursor-default items-center justify-center rounded-lg transition-colors [&_svg]:size-[18px]",
                    draft.icon === name ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <PresetIcon name={name} weight={draft.icon === name ? "fill" : "bold"} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel>{t("voice.color")}</SectionLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(SOUND_COLORS).map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => patch({ color: name })}
                  className={cn(
                    "h-6 w-8 cursor-default rounded-lg transition-transform hover:scale-110",
                    draft.color === name && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
                  )}
                  style={{ background: value }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel>{t("voice.hotkey")}</SectionLabel>
            <HotkeyRecorder
              value={draft.hotkey}
              label={draft.hotkeyLabel}
              onChange={(hotkey, hotkeyLabel) => patch({ hotkey, hotkeyLabel })}
            />
            <p className="text-2xs text-muted-foreground">{t("voice.hotkeyHint")}</p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            disabled={overwritten || sameVoice(draft.voice, voice)}
            onClick={() => {
              patch({ voice: { ...voice, enabled: true } });
              setOverwritten(true);
            }}
          >
            {overwritten ? t("voice.overwritten") : t("voice.overwrite")}
          </Button>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size="sm"
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              void actions.deletePreset(preset.id);
              onClose();
            }}
          >
            {confirmDelete ? t("voice.confirmDelete") : t("voice.delete")}
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => void close()}>
            {t("voice.done")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Eine Taste der Preset-Reihe: Symbol in der Preset-Farbe und Name.
 * Gewählt hebt sie sich hell heraus und trägt einen Rahmen in ihrer Farbe.
 */
function BankKey({
  active,
  color,
  icon,
  label,
  title,
  onClick,
  onEdit,
}: {
  active: boolean;
  color: string;
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="group relative min-w-0 flex-1" style={{ "--key": color } as CSSProperties}>
      <button
        type="button"
        title={title ?? label}
        aria-pressed={active}
        onClick={onClick}
        onContextMenu={(e) => {
          if (!onEdit) return;
          e.preventDefault();
          onEdit();
        }}
        className={cn(
          // Rundung der Mulde (16) minus Innenabstand (6).
          "flex h-[clamp(60px,9vh,80px)] w-full cursor-default flex-col items-center justify-center gap-1.5 rounded-[10px] px-2 transition-all duration-200 [&_svg]:size-6",
          active
            ? "bg-panel-raised shadow-[inset_0_0_0_2px_var(--key),0_4px_12px_-6px_oklch(0%_0_0/45%)]"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <span className="text-[var(--key)]">{icon}</span>
        <span className={cn("w-full truncate text-center text-xs", active ? "font-semibold text-foreground" : "font-medium")}>{label}</span>
      </button>
      {onEdit && (
        <button
          type="button"
          title={t("voice.editPreset")}
          onClick={onEdit}
          className="absolute top-1 right-1 flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground [&_svg]:size-3.5"
        >
          <PencilSimple />
        </button>
      )}
    </div>
  );
}

const KEY_MIN_WIDTH = 96;

/** Wie viele Tasten nebeneinander passen. */
function useKeyCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(8);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCount(Math.max(1, Math.floor(entry.contentRect.width / KEY_MIN_WIDTH))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, count };
}

/**
 * Die Stimme als eine Reihe von Wahltasten: „Aus“, „Eigene“ (die gerade
 * eingestellte Stimme) und die Presets. Genau eine gilt; mehr Presets als
 * Platz blättern seitenweise. Rechtsklick auf ein Preset bearbeitet es.
 */
export function PresetBank({ onEdit, aside }: { onEdit: (preset: Preset) => void; aside?: ReactNode }) {
  const presets = useStore((s) => s.presets);
  const active = useStore((s) => s.activePreset);
  const voice = useStore((s) => s.effects.voice);
  const fit = useKeyCount();
  const [page, setPage] = useState(0);
  // Aus und Eigene sind immer da, der Rest der Reihe gehört den Presets.
  const perPage = Math.max(1, fit.count - 2);
  const pages = Math.max(1, Math.ceil(presets.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = presets.slice(current * perPage, (current + 1) * perPage);
  const running = presets.find((p) => p.id === active && voice.enabled);
  const own = voice.enabled && !running;
  const turn = (delta: number) => setPage(Math.min(pages - 1, Math.max(0, current + delta)));

  return (
    <div className="panel flex shrink-0 items-center gap-1 rounded-2xl p-1.5">
      <div ref={fit.ref} onWheel={(e) => pages > 1 && Math.abs(e.deltaY) > 20 && turn(e.deltaY > 0 ? 1 : -1)} className="flex min-w-0 flex-1 gap-1">
        <BankKey active={!voice.enabled} color="var(--muted-foreground)" icon={<Prohibit />} label={t("voice.off")} onClick={() => void actions.presetOff()} />
        <BankKey
          active={own}
          color="var(--ch-mic)"
          icon={<SlidersHorizontal />}
          label={t("voice.own")}
          onClick={() => actions.setVoiceEnabled(true)}
        />
        <div className="mx-1 w-px self-stretch bg-hairline" />
        {shown.map((p) => (
          <BankKey
            key={p.id}
            active={running?.id === p.id}
            color={soundColor(p.color)}
            icon={<PresetIcon name={p.icon} weight={running?.id === p.id ? "fill" : "duotone"} />}
            label={presetName(p)}
            title={p.hotkey ? `${presetName(p)} · ${hotkeyLabel(p.hotkey, p.hotkeyLabel).join(" + ")}` : undefined}
            onClick={() => void actions.applyPreset(p.id)}
            onEdit={() => onEdit(p)}
          />
        ))}
        {/* Leere Plätze halten die Tastenbreite auf der letzten Seite. */}
        {Array.from({ length: perPage - shown.length }, (_, i) => (
          <div key={i} className="min-w-0 flex-1" />
        ))}
      </div>
      {pages > 1 && (
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            title={t("common.previousPage")}
            disabled={current === 0}
            onClick={() => turn(-1)}
            className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 [&_svg]:size-4"
          >
            <CaretUp />
          </button>
          <button
            type="button"
            title={t("common.nextPage")}
            disabled={current === pages - 1}
            onClick={() => turn(1)}
            className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 [&_svg]:size-4"
          >
            <CaretDown />
          </button>
        </div>
      )}
      {aside}
    </div>
  );
}
