import { PencilSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { HelpIcon } from "~/components/effects/HelpDrawer";
import { HotkeyRecorder } from "~/components/soundboard/HotkeyRecorder";
import { hotkeyLabel } from "~/components/soundboard/hotkey";
import { Button } from "~/components/ui/button";
import { HardwareKey, PushButtons } from "~/components/ui/hardware";
import { Card, EmptyState, Kbd, SectionLabel } from "~/components/ui/misc";
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
    <div className="group relative h-full min-w-0" style={{ "--ch-mic": soundColor(preset.color) } as CSSProperties}>
      <HardwareKey
        on={active}
        title={presetName(preset)}
        className="size-full justify-between gap-1 px-2 pt-5 pb-2.5 [&_svg]:size-8"
        onClick={() => void (active ? actions.presetOff() : actions.applyPreset(preset.id))}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit();
        }}
      >
        {/* Eingerastet: die Taste trägt ihre Farbe. */}
        <span className={cn("pointer-events-none absolute inset-0 bg-[var(--ch-mic)] transition-opacity", active ? "opacity-[0.14]" : "opacity-0")} />
        <PresetIcon name={preset.icon} weight={active ? "fill" : "duotone"} className="relative text-[var(--ch-mic)]" />
        <span className="relative w-full truncate py-0.5 text-center text-[11px] leading-normal tracking-[0.08em] text-foreground">
          {presetName(preset)}
        </span>
        <span className="relative flex h-4 items-center gap-0.5 normal-case">
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
        className="absolute top-2.5 right-1.5 flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground [&_svg]:size-3.5"
      >
        <PencilSimple />
      </button>
    </div>
  );
}

/**
 * Display über der Tastenbank, wie das Leuchtdisplay eines Effektgeräts:
 * immer dunkel, Symbol und Name in der Farbe des laufenden Presets, dazu
 * eine Pegelkette der Stimme.
 */
function BankDisplay({ running, modified }: { running: Preset | undefined; modified: boolean }) {
  const enabled = useStore((s) => s.effects.voice.enabled);
  const peak = useStore((s) => (s.info ? (s.meters?.channels.find((c) => c.id === "mic")?.peak ?? 0) : 0));
  const color = running ? soundColor(running.color) : "oklch(70% 0.01 70)";
  const level = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(peak, 1e-5)) + 60) / 60));
  return (
    <div
      className="flex h-[76px] shrink-0 items-center gap-5 rounded-xl bg-[oklch(16%_0.006_60)] px-5 shadow-[inset_0_2px_10px_oklch(0%_0_0/55%),0_0_0_1px_oklch(0%_0_0/30%)]"
      style={{ "--ch": color } as CSSProperties}
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[var(--ch)] [&_svg]:size-7">
        <PresetIcon name={running?.icon ?? "microphone"} weight={running ? "fill" : "duotone"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9px] font-semibold tracking-[0.18em] text-white/45 uppercase">
          {running ? t("voice.playing") : t("voice.presets")}
          {modified && <span className="ml-2 text-[var(--ch)]">· {t("voice.modified")}</span>}
        </div>
        <div className="truncate font-mono text-2xl leading-tight font-semibold tracking-[0.1em] text-[var(--ch)] uppercase">
          {running ? presetName(running) : enabled ? t("voice.custom") : t("voice.off")}
        </div>
      </div>
      {running?.hotkey && (
        <div className="flex gap-1">
          {hotkeyLabel(running.hotkey, running.hotkeyLabel).map((k, i) => (
            <span key={`${i}-${k}`} className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
              {k}
            </span>
          ))}
        </div>
      )}
      {/* Pegelkette der Stimme */}
      <div className="hidden w-40 flex-col gap-1 md:flex">
        <div className="flex h-3 gap-[3px]">
          {Array.from({ length: 16 }, (_, i) => {
            const on = level > i / 16;
            return (
              <span
                key={i}
                className="flex-1 rounded-[2px] transition-colors duration-75"
                style={{ background: on ? (i >= 14 ? "var(--error)" : "var(--ch)") : "oklch(100% 0 0 / 8%)" }}
              />
            );
          })}
        </div>
        <span className="font-mono text-[9px] tracking-[0.18em] text-white/45 uppercase">{t("voice.input")}</span>
      </div>
      <HelpIcon topic="presets" className="text-white/50 hover:bg-white/10 hover:text-white" />
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
  const modified = !!running && !sameVoice(running.voice, voice);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pr-3 pb-3 pl-6">
      <Card className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <BankDisplay running={running} modified={modified} />
          </div>
          {banks > 1 && (
            <PushButtons
              label={t("voice.bank")}
              value={current}
              className="w-[clamp(96px,14vw,180px)]"
              options={Array.from({ length: banks }, (_, i) => ({ value: i, label: String.fromCharCode(65 + i) }))}
              onChange={setPage}
            />
          )}
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
