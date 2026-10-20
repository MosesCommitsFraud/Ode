import { CaretDown, CaretUp, PencilSimple, Prohibit, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
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
  compact,
  hotkey,
}: {
  active: boolean;
  color: string;
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  onEdit?: () => void;
  /** Flach in einer Zeile: Symbol neben dem Namen. */
  compact?: boolean;
  hotkey?: string;
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
          "flex w-full cursor-default items-center rounded-[10px] px-2 transition-all duration-200",
          compact ? "h-10 justify-start gap-2 [&_svg]:size-4" : "h-[76px] flex-col justify-center gap-1 [&_svg]:size-6",
          active
            ? "bg-panel-raised shadow-[inset_0_0_0_2px_var(--key),0_4px_12px_-6px_oklch(0%_0_0/45%)]"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <span className="text-[var(--key)]">{icon}</span>
        <span className={cn("min-w-0 truncate text-xs", !compact && "w-full text-center", active ? "font-semibold text-foreground" : "font-medium")}>{label}</span>
        {hotkey && <span className="max-w-full truncate font-mono text-[9px] text-muted-foreground">{hotkey}</span>}
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

const PER_PAGE = 20;

/**
 * Die Stimme als Auswahlfeld: zeigt, was gerade läuft (Preset, „Eigene“
 * oder „Aus“). Ein Klick öffnet alle Presets als Raster, dazu Aus und
 * Eigene; unten Platz für Aktionen (Speichern, Zurückholen). Rechtsklick
 * oder der Stift auf einem Preset bearbeitet es.
 */
export function PresetPicker({ onEdit, actions: footer, className }: { onEdit: (preset: Preset) => void; actions?: ReactNode; className?: string }) {
  const presets = useStore((s) => s.presets);
  const active = useStore((s) => s.activePreset);
  const voice = useStore((s) => s.effects.voice);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const running = presets.find((p) => p.id === active && voice.enabled);
  const own = voice.enabled && !running;
  const pages = Math.max(1, Math.ceil(presets.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = presets.slice(current * PER_PAGE, (current + 1) * PER_PAGE);


  const choose = (run: () => void) => {
    run();
    setOpen(false);
  };
  const color = running ? soundColor(running.color) : own ? "var(--ch-mic)" : "var(--muted-foreground)";
  const name = running ? presetName(running) : own ? t("voice.own") : t("voice.off");

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger
        style={{ "--key": color } as CSSProperties}
        className={cn("well flex h-9 w-56 shrink-0 cursor-default items-center gap-2 rounded-full pr-3 pl-1.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-panel-raised text-[var(--key)] shadow-[0_1px_0_var(--hairline)] [&_svg]:size-4">
          {running ? <PresetIcon name={running.icon} weight="fill" /> : own ? <SlidersHorizontal /> : <Prohibit />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] leading-none tracking-[0.14em] text-muted-foreground uppercase">{t("voice.presets")}</span>
          <span className="block truncate text-[13px] leading-tight font-semibold">{name}</span>
        </span>
        <CaretDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="panel z-50 flex w-[min(640px,calc(100vw-22rem))] origin-(--radix-popover-content-transform-origin) animate-[pop-in_180ms_var(--ease-drawer)] flex-col gap-2 rounded-2xl p-2 shadow-[0_18px_50px_-12px_oklch(0%_0_0/45%)] outline-none"
        >
          <div className="flex gap-1">
            <BankKey compact active={!voice.enabled} color="var(--muted-foreground)" icon={<Prohibit />} label={t("voice.off")} onClick={() => choose(() => void actions.presetOff())} />
            <BankKey compact active={own} color="var(--ch-mic)" icon={<SlidersHorizontal />} label={t("voice.own")} onClick={() => choose(() => actions.setVoiceEnabled(true))} />
          </div>
          <div className="h-px bg-hairline" />
          <div className="grid grid-cols-5 gap-1">
            {shown.map((p) => (
              <BankKey
                key={p.id}
                active={running?.id === p.id}
                color={soundColor(p.color)}
                icon={<PresetIcon name={p.icon} weight={running?.id === p.id ? "fill" : "duotone"} />}
                label={presetName(p)}
                title={p.hotkey ? `${presetName(p)} · ${hotkeyLabel(p.hotkey, p.hotkeyLabel).join(" + ")}` : undefined}
                hotkey={p.hotkey ? hotkeyLabel(p.hotkey, p.hotkeyLabel).join("+") : undefined}
                onClick={() => choose(() => void actions.applyPreset(p.id))}
                onEdit={() => {
                  setOpen(false);
                  onEdit(p);
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-hairline px-1 pt-2">
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-30 [&_svg]:size-4">
                  <CaretUp className="-rotate-90" />
                </button>
                <span className="font-mono text-2xs text-muted-foreground tabular-nums">{t("common.page", { current: current + 1, pages })}</span>
                <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="flex size-7 cursor-default items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-30 [&_svg]:size-4">
                  <CaretUp className="rotate-90" />
                </button>
              </div>
            )}
            <div className="flex-1" />
            {footer}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
