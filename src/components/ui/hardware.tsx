import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import { cn } from "~/lib/utils";

/*
 * Bedienelemente wie an Rack-Geräten: Schiebefader, Drucktasten mit
 * Leuchtstreifen und eingravierte Beschriftung. Leuchten sind flache
 * Farbflächen, ohne Schein.
 */

/** Beschriftung wie auf eine Frontplatte gedruckt. */
export function Engraved({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("block truncate font-mono text-[9px] leading-tight font-semibold tracking-[0.14em] text-muted-foreground uppercase", className)}>
      {children}
    </span>
  );
}

/** Beschriftung und Wert unter einem Bedienelement. */
export function Caption({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="w-full min-w-0 text-center">
      <Engraved>{label}</Engraved>
      {value !== undefined && <div className="truncate font-mono text-2xs leading-tight tabular-nums">{value}</div>}
    </div>
  );
}

/** Höhe der Faderkappe in px; der Weg endet je eine halbe Kappe vor dem Rand. */
const CAP = 28;

/**
 * Senkrechter Fader mit Skala, Kappe wie am Pult; Füllung in `color`, bei
 * `bipolar` von der Mitte aus. Nimmt die Höhe seines Platzes ein.
 */
export function SlideFader({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  reset,
  disabled,
  color = "var(--ch-mic)",
  ticks = 5,
  tickLabel,
  scale,
  bipolar,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  reset?: number;
  disabled?: boolean;
  color?: string;
  ticks?: number;
  /** Beschriftung der Skalenstriche; ohne nur Striche. */
  tickLabel?: (v: number) => string;
  /** Werte der Skalenstriche; ohne gleichmäßig `ticks` Stück. */
  scale?: number[];
  bipolar?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const range = max - min;
  const pos = range > 0 ? (value - min) / range : 0;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const set = (v: number) => {
    const next = Number(clamp(v).toFixed(6));
    if (next !== value) onChange(next);
  };

  const fromPointer = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    // Der Weg endet je eine halbe Kappe vor dem Rand.
    const p = 1 - (clientY - rect.top - CAP / 2) / Math.max(1, rect.height - CAP);
    set(min + Math.min(1, Math.max(0, p)) * range);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    fromPointer(e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    const big = Math.max(step, Math.round(range / step / 10) * step);
    const delta: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big };
    if (e.key in delta) set(value + delta[e.key]);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else return;
    e.preventDefault();
  };

  const marks = scale
    ? scale.map((v) => (v - min) / range)
    : Array.from({ length: ticks }, (_, i) => i / Math.max(1, ticks - 1));
  const at = (p: number) => `calc(${CAP / 2}px + (100% - ${CAP}px) * ${p})`;

  return (
    <div className={cn("flex h-full min-h-0 min-w-14 flex-col items-center gap-1.5 select-none", disabled && "opacity-45")} style={{ "--ch": color } as CSSProperties}>
      <div className="flex min-h-[44px] flex-1 items-stretch gap-1">
        {tickLabel && (
          <div className="relative w-6 font-mono text-[9px] leading-none text-muted-foreground/70 tabular-nums">
            {marks.map((p) => (
              <span key={p} className="absolute right-0 translate-y-1/2 whitespace-nowrap" style={{ bottom: at(p) }}>
                {tickLabel(min + p * range)}
              </span>
            ))}
          </div>
        )}
        <div
          ref={track}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format(value)}
          aria-orientation="vertical"
          aria-disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={() => !disabled && reset !== undefined && set(reset)}
          onKeyDown={onKeyDown}
          className="group relative w-10 cursor-default touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {marks.map((p) => (
            <span key={p} className="absolute left-1/2 h-px w-7 -translate-x-1/2 bg-muted-foreground/30" style={{ bottom: at(p) }} />
          ))}
          <div className="well absolute inset-y-3 left-1/2 w-1.5 -translate-x-1/2 rounded-full" />
          <div
            className="absolute left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-[var(--ch)]"
            style={{ bottom: `calc(12px + (100% - 24px) * ${bipolar ? Math.min(pos, 0.5) : 0})`, height: `calc((100% - 24px) * ${bipolar ? Math.abs(pos - 0.5) : pos})` }}
          />
          <div
            className={cn(
              "absolute left-1/2 h-7 w-10 -translate-x-1/2 translate-y-1/2 rounded-[7px]",
              "bg-[linear-gradient(to_bottom,oklch(98%_0.003_75),oklch(86%_0.006_75))] dark:bg-[linear-gradient(to_bottom,oklch(40%_0.006_60),oklch(26%_0.006_60))]",
              "shadow-[0_1px_0_oklch(100%_0_0/35%)_inset,0_5px_12px_-4px_oklch(0%_0_0/55%),0_0_0_1px_oklch(0%_0_0/18%)]",
              !disabled && "group-active:scale-95",
            )}
            style={{ bottom: at(pos) }}
          >
            <span className="absolute inset-x-1.5 top-[5px] h-px bg-black/10 dark:bg-white/8" />
            <span className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--ch)]" />
            <span className="absolute inset-x-1.5 bottom-[5px] h-px bg-black/10 dark:bg-white/8" />
          </div>
        </div>
      </div>
      <Caption label={label} value={format(value)} />
    </div>
  );
}

/** Ein Taster: eingerastet leuchtet sein Streifen. */
export function HardwareKey({
  on,
  onClick,
  disabled,
  title,
  children,
  className,
  onContextMenu,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  className?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex min-w-0 flex-1 cursor-default flex-col items-center justify-end gap-0.5 overflow-hidden rounded-[7px] px-1.5 pt-2.5 pb-1 font-mono text-[10px] leading-normal font-semibold tracking-wide uppercase transition-[transform,box-shadow,color] duration-100",
        "bg-[linear-gradient(to_bottom,oklch(98%_0.003_75),oklch(88%_0.006_75))] dark:bg-[linear-gradient(to_bottom,oklch(34%_0.006_60),oklch(24%_0.006_60))]",
        on
          ? "translate-y-px text-foreground shadow-[0_1px_0_oklch(100%_0_0/25%)_inset,0_1px_2px_oklch(0%_0_0/45%),0_0_0_1px_oklch(0%_0_0/22%)]"
          : "text-muted-foreground shadow-[0_1px_0_oklch(100%_0_0/35%)_inset,0_4px_8px_-3px_oklch(0%_0_0/55%),0_0_0_1px_oklch(0%_0_0/18%)] hover:text-foreground",
        "disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
    >
      {/* Leuchtstreifen oben */}
      <span className={cn("absolute inset-x-2 top-1 h-[3px] rounded-full transition-colors", on ? "bg-[var(--ch-mic)]" : "bg-[var(--led-off)]")} />
      {children}
    </button>
  );
}

/** Taste in einer Mulde: gewählt hebt sie sich hell heraus und trägt die Gerätefarbe. */
function WellKey({ on, onClick, disabled, title, children }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-0 flex-1 cursor-default items-center justify-center gap-1 truncate rounded-[6px] px-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-200 [&_svg]:size-4 [&_svg]:shrink-0",
        on
          ? "bg-panel-raised text-[var(--ch-mic)] shadow-[0_1px_0_var(--hairline),0_3px_8px_-4px_oklch(0%_0_0/40%)]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Wahltasten (Radix ToggleGroup), von denen genau eine gilt; in einer Reihe oder als Block mit `columns` Spalten. */
export function PushButtons<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  columns,
}: {
  label?: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
  columns?: number;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1.5", disabled && "opacity-45", className)}>
      <RadixToggleGroup.Root
        type="single"
        value={String(value)}
        disabled={disabled}
        // Abwählen gibt es nicht: ein zweiter Klick auf die gewählte Taste ändert nichts.
        onValueChange={(v) => {
          const next = options.find((o) => String(o.value) === v);
          if (next) onChange(next.value);
        }}
        className="well grid w-full gap-1 rounded-[10px] p-1"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <RadixToggleGroup.Item
            key={String(o.value)}
            value={String(o.value)}
            title={o.title}
            className={cn(
              "flex h-7 min-w-0 cursor-default items-center justify-center gap-1 truncate rounded-[6px] px-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
              "text-muted-foreground hover:text-foreground data-[state=on]:bg-panel-raised data-[state=on]:text-[var(--ch-mic)] data-[state=on]:shadow-[0_1px_0_var(--hairline),0_3px_8px_-4px_oklch(0%_0_0/40%)]",
            )}
          >
            {o.label}
          </RadixToggleGroup.Item>
        ))}
      </RadixToggleGroup.Root>
      {label && <Caption label={label} />}
    </div>
  );
}

/** Einzelne Taste für An/Aus einer Option. */
export function PushButton({
  label,
  caption,
  on,
  onChange,
  disabled,
  title,
  className,
}: {
  label: ReactNode;
  /** Beschriftung darunter. */
  caption?: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1.5", disabled && "opacity-45", className)}>
      <div className="well flex w-full rounded-[10px] p-1">
        <WellKey on={on} disabled={disabled} title={title} onClick={() => onChange(!on)}>
          {label}
        </WellKey>
      </div>
      {caption && <Caption label={caption} />}
    </div>
  );
}

/**
 * Kleiner Schalter für An/Aus eines Geräts: die Bahn färbt sich in der
 * Gerätefarbe, der Knopf springt mit etwas Schwung hinüber und streckt sich
 * beim Drücken.
 */
export function Toggle({ on, onChange, label, size = "md" }: { on: boolean; onChange: (on: boolean) => void; label: string; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <RadixSwitch.Root
      checked={on}
      onCheckedChange={onChange}
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "group relative flex shrink-0 cursor-default items-center rounded-full p-0.5 outline-none transition-[background-color,box-shadow] duration-300 focus-visible:ring-2 focus-visible:ring-ring",
        sm ? "h-[18px] w-[30px]" : "h-[22px] w-[38px]",
        on ? "bg-[var(--ch-mic)]" : "bg-[oklch(0%_0_0/12%)] shadow-[inset_0_1px_2px_oklch(0%_0_0/18%)] dark:bg-[oklch(100%_0_0/12%)]",
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block h-full rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/35%)] transition-[transform,width] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          sm ? "w-[14px] group-active:w-[18px]" : "w-[18px] group-active:w-[22px]",
          on && (sm ? "translate-x-[12px] group-active:translate-x-[8px]" : "translate-x-[16px] group-active:translate-x-[12px]"),
        )}
      />
    </RadixSwitch.Root>
  );
}
