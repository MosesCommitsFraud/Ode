import { CaretLeft, CaretRight, PencilSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HotkeyRecorder } from "~/components/soundboard/HotkeyRecorder";
import { hotkeyLabel } from "~/components/soundboard/hotkey";
import { Button } from "~/components/ui/button";
import { Engraved, HardwareKey } from "~/components/ui/hardware";
import { Card, EmptyState, Kbd, SectionLabel } from "~/components/ui/misc";
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

const KEY_MIN_WIDTH = 104;
const KEY_MIN_HEIGHT = 100;
const KEY_MAX_HEIGHT = 190;
const GAP = 8;

/** Tasten füllen den Bereich: bis zu drei Reihen, Höhe nach Platz. */
function useBankSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cols: 8, rows: 2, space: 240 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const rows = Math.min(3, Math.max(1, Math.floor((height + GAP) / (KEY_MIN_HEIGHT + GAP))));
      setSize({
        cols: Math.max(1, Math.floor((width + GAP) / (KEY_MIN_WIDTH + GAP))),
        rows,
        space: height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** Eine Preset-Taste: Leuchtstreifen, Symbol, Name, Hotkey. */
function PresetKey({ preset, active, onEdit }: { preset: Preset; active: boolean; onEdit: () => void }) {
  return (
    <div className="group relative h-full min-w-0">
      <HardwareKey
        on={active}
        title={presetName(preset)}
        className="size-full justify-between gap-1.5 px-2 pt-4 pb-2 [&_svg]:size-6"
        onClick={() => void (active ? actions.presetOff() : actions.applyPreset(preset.id))}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit();
        }}
      >
        <PresetIcon name={preset.icon} weight={active ? "fill" : "bold"} className={cn(active && "text-[var(--ch-mic)]")} />
        <span className="w-full truncate py-0.5 text-center text-[10px] leading-normal tracking-[0.08em]">{presetName(preset)}</span>
        <span className="flex h-4 items-center gap-0.5 normal-case">
          {preset.hotkey &&
            hotkeyLabel(preset.hotkey, preset.hotkeyLabel).map((k, i) => (
              <Kbd key={`${i}-${k}`} className="h-4 min-w-4 px-1 text-[9px]">
                {k}
              </Kbd>
            ))}
        </span>
      </HardwareKey>
      <button
        type="button"
        title={t("voice.editPreset")}
        onClick={onEdit}
        className="absolute top-2 right-1.5 flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground [&_svg]:size-3.5"
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

/**
 * Presets als Tastenbank wie an einem Effektgerät: oben das Display mit dem
 * laufenden Preset, darunter die Tasten, seitenweise in Bänken. Drücken
 * schaltet ein, nochmal drücken aus.
 */
export function PresetBank({ onEdit }: { onEdit: (preset: Preset) => void }) {
  const presets = useStore((s) => s.presets);
  const active = useStore((s) => s.activePreset);
  const voice = useStore((s) => s.effects.voice);
  const bank = useBankSize();
  const [page, setPage] = useState(0);
  const perBank = bank.cols * bank.rows;
  const banks = Math.max(1, Math.ceil(presets.length / perBank));
  const current = Math.min(page, banks - 1);
  const shown = presets.slice(current * perBank, (current + 1) * perBank);
  // Die belegten Reihen teilen sich die Höhe.
  const usedRows = Math.max(1, Math.min(bank.rows, Math.ceil(shown.length / bank.cols)));
  const keyHeight = Math.min(KEY_MAX_HEIGHT, Math.floor((bank.space - GAP * (usedRows - 1)) / usedRows));
  const turn = (delta: number) => setPage(Math.min(banks - 1, Math.max(0, current + delta)));
  const running = presets.find((p) => p.id === active && voice.enabled);
  const modified = running && !sameVoice(running.voice, voice);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pr-3 pb-3 pl-6">
      <Card className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {/* Display */}
        <div className="well flex h-16 shrink-0 items-center gap-4 rounded-xl px-5">
          <div className="min-w-0 flex-1">
            <Engraved>{t("voice.presets")}</Engraved>
            <div className={cn("truncate font-mono text-xl font-semibold tracking-[0.12em] uppercase", running ? "text-[var(--ch-mic)]" : "text-muted-foreground")}>
              {running ? presetName(running) : voice.enabled ? t("voice.custom") : t("voice.off")}
              {modified && <span className="ml-3 text-xs tracking-normal text-muted-foreground normal-case">{t("voice.modified")}</span>}
            </div>
          </div>
          {running?.hotkey && (
            <div className="flex gap-1">
              {hotkeyLabel(running.hotkey, running.hotkeyLabel).map((k, i) => (
                <Kbd key={`${i}-${k}`}>{k}</Kbd>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" title={t("common.previousPage")} disabled={current === 0} onClick={() => turn(-1)}>
              <CaretLeft />
            </Button>
            <div className="w-16 text-center">
              <Engraved>{t("voice.bank")}</Engraved>
              <div className="font-mono text-sm tabular-nums">
                {current + 1} / {banks}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" title={t("common.nextPage")} disabled={current === banks - 1} onClick={() => turn(1)}>
              <CaretRight />
            </Button>
          </div>
        </div>

        <div ref={bank.ref} onWheel={(e) => banks > 1 && Math.abs(e.deltaY) > 20 && turn(e.deltaY > 0 ? 1 : -1)} className="min-h-0 flex-1 overflow-hidden">
          {presets.length === 0 ? (
            <EmptyState icon={<PresetIcon name="microphone" weight="duotone" />} title={t("voice.emptyTitle")}>
              {t("voice.emptyHint")}
            </EmptyState>
          ) : (
            <div
              key={current}
              className="grid animate-[layout-in_260ms_var(--ease-drawer)]"
              style={{ gap: GAP, gridTemplateColumns: `repeat(${bank.cols}, minmax(0, 1fr))`, gridAutoRows: keyHeight }}
            >
              {shown.map((p) => (
                <PresetKey key={p.id} preset={p} active={voice.enabled && active === p.id} onEdit={() => onEdit(p)} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
