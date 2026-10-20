import { CaretLeft, CaretRight, PencilSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { HotkeyRecorder } from "~/components/soundboard/HotkeyRecorder";
import { hotkeyLabel } from "~/components/soundboard/hotkey";
import { Button } from "~/components/ui/button";
import { EmptyState, Kbd, SectionLabel } from "~/components/ui/misc";
import type { Preset, VoiceParams } from "~/lib/engine";
import { t } from "~/lib/i18n";
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

const TILE_MIN_WIDTH = 150;
const TILE_HEIGHT = 108;
const GAP = 12;

function useGridSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cols: 4, rows: 3 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({
        cols: Math.max(1, Math.floor((width + GAP) / (TILE_MIN_WIDTH + GAP))),
        rows: Math.max(1, Math.floor((height + GAP) / (TILE_HEIGHT + GAP))),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function PresetTile({ preset, active, modified, onEdit }: { preset: Preset; active: boolean; modified: boolean; onEdit: () => void }) {
  const toggle = () => void (active ? actions.presetOff() : actions.applyPreset(preset.id));
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={toggle}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn(
        "group panel relative flex h-full cursor-default flex-col gap-2 overflow-hidden rounded-2xl p-3 text-left outline-none transition-transform duration-150 select-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98]",
        active && "shadow-[inset_0_0_0_1.5px_var(--primary)]",
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-xl transition-colors [&_svg]:size-5",
          active ? "bg-primary text-primary-foreground" : "well text-muted-foreground group-hover:text-foreground",
        )}
      >
        <PresetIcon name={preset.icon} weight={active ? "fill" : "bold"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-tight font-semibold" title={presetName(preset)}>
          {presetName(preset)}
        </div>
        {active && modified && <div className="mt-0.5 font-mono text-3xs text-muted-foreground">{t("voice.modified")}</div>}
      </div>
      {preset.hotkey && (
        <div className="flex gap-1">
          {hotkeyLabel(preset.hotkey, preset.hotkeyLabel).map((k, i) => (
            <Kbd key={`${i}-${k}`}>{k}</Kbd>
          ))}
        </div>
      )}
      <button
        type="button"
        title={t("voice.editPreset")}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          onEdit();
        }}
        className="absolute top-2 right-2 flex size-7 cursor-default items-center justify-center rounded-lg bg-panel-raised text-muted-foreground opacity-0 shadow-[0_0_0_1px_var(--hairline)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 hover:text-foreground [&_svg]:size-4"
      >
        <PencilSimple />
      </button>
    </div>
  );
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
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground [&_svg]:size-5">
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

/** Alle Presets als Kacheln, seitenweise. Klick schaltet ein, nochmal aus. */
export function PresetGrid({ onEdit }: { onEdit: (preset: Preset) => void }) {
  const presets = useStore((s) => s.presets);
  const active = useStore((s) => s.activePreset);
  const voice = useStore((s) => s.effects.voice);
  const grid = useGridSize();
  const [page, setPage] = useState(0);
  const pageSize = grid.cols * grid.rows;
  const pages = Math.max(1, Math.ceil(presets.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = presets.slice(current * pageSize, (current + 1) * pageSize);
  const turn = (delta: number) => setPage(Math.min(pages - 1, Math.max(0, current + delta)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={grid.ref}
        onWheel={(e) => pages > 1 && Math.abs(e.deltaY) > 20 && turn(e.deltaY > 0 ? 1 : -1)}
        className="min-h-0 flex-1 overflow-hidden pr-3 pl-6"
      >
        {presets.length === 0 ? (
          <EmptyState icon={<PresetIcon name="microphone" weight="duotone" />} title={t("voice.emptyTitle")}>
            {t("voice.emptyHint")}
          </EmptyState>
        ) : (
          <div
            className="grid"
            style={{ gap: GAP, gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridAutoRows: TILE_HEIGHT }}
          >
            {shown.map((p) => (
              <PresetTile
                key={p.id}
                preset={p}
                active={voice.enabled && active === p.id}
                modified={!sameVoice(p.voice, voice)}
                onEdit={() => onEdit(p)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center justify-center gap-3 pr-3 pl-6">
        {pages > 1 && (
          <>
            <Button variant="ghost" size="icon-sm" title={t("common.previousPage")} disabled={current === 0} onClick={() => turn(-1)}>
              <CaretLeft />
            </Button>
            <span className="font-mono text-2xs text-muted-foreground tabular-nums">{t("common.page", { current: current + 1, pages })}</span>
            <Button variant="ghost" size="icon-sm" title={t("common.nextPage")} disabled={current === pages - 1} onClick={() => turn(1)}>
              <CaretRight />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
