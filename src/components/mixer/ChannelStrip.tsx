import type { CSSProperties, ReactNode } from "react";
import { Headphones, Mic2, VolumeX } from "lucide-react";
import { cn, formatDb, gainToDb } from "~/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";

/** Taster mit LED, wie auf einem Pult. */
function PadButton({
  active,
  onClick,
  title,
  children,
  tone = "channel",
  disabled,
  className,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  tone?: "channel" | "error";
  disabled?: boolean;
  className?: string;
}) {
  const color = tone === "error" ? "var(--error)" : "var(--ch)";
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{ "--pad": color } as CSSProperties}
      className={cn(
        "relative flex h-8 flex-1 cursor-default items-center justify-center gap-1.5 rounded-lg font-mono text-2xs font-semibold transition-all duration-150 disabled:opacity-40 [&_svg]:size-3.5",
        active
          ? "bg-[color-mix(in_oklch,var(--pad)_18%,transparent)] text-[var(--pad)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--pad)_40%,transparent)_inset,0_0_18px_-6px_var(--pad)]"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-1.5 right-1.5 size-1 rounded-full transition-all",
          active ? "bg-[var(--pad)] shadow-[0_0_6px_var(--pad)]" : "bg-muted-foreground/30",
        )}
      />
      {children}
    </button>
  );
}

export interface StripProps {
  name: string;
  kind: string;
  icon: ReactNode;
  color: string;
  gainDb: number;
  muted: boolean;
  peak: number;
  onGain: (db: number) => void;
  onMute: (muted: boolean) => void;
  routing?: {
    a: boolean;
    b: boolean;
    onA: (on: boolean) => void;
    onB: (on: boolean) => void;
  };
  footer?: ReactNode;
  disabled?: boolean;
  badge?: string;
}

export function ChannelStrip({
  name,
  kind,
  icon,
  color,
  gainDb,
  muted,
  peak,
  onGain,
  onMute,
  routing,
  footer,
  disabled,
  badge,
}: StripProps) {
  const live = muted ? 0 : peak;
  // Das Symbol glüht mit dem Pegel mit.
  const glow = Math.max(0, (gainToDb(live, -48) + 48) / 48);

  return (
    <div
      style={{ "--ch": color } as CSSProperties}
      className={cn("flex w-[9.25rem] shrink-0 flex-col px-3 py-3.5", disabled && "opacity-55")}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--ch)_16%,transparent)] text-[var(--ch)] transition-shadow duration-75 [&_svg]:size-4"
          style={{ boxShadow: `0 0 ${4 + glow * 22}px -4px color-mix(in oklch, var(--ch) ${Math.round(glow * 90)}%, transparent)` }}
        >
          {icon}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="truncate font-mono text-3xs text-muted-foreground uppercase">{badge ?? kind}</div>
        </div>
      </div>

      <div
        className={cn(
          "well mt-3 rounded-lg py-1.5 text-center font-mono text-sm font-medium tabular-nums transition-colors",
          muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-foreground",
        )}
      >
        {muted ? "MUTE" : formatDb(gainDb)}
        {!muted && <span className="ml-1 text-3xs text-muted-foreground">dB</span>}
      </div>

      <div className="flex min-h-0 flex-1 justify-center">
        <Fader
          label={`${name} Lautstärke`}
          value={gainDb}
          onChange={onGain}
          disabled={disabled}
          meter={<Meter peak={live} className="my-0" />}
        />
      </div>

      <div className="space-y-1.5">
        {routing && (
          <div className="flex gap-1.5">
            <PadButton
              title="Auf Kopfhörer (A)"
              active={routing.a}
              onClick={() => routing.onA(!routing.a)}
              disabled={disabled}
            >
              <Headphones />A
            </PadButton>
            <PadButton
              title="Auf virtuelles Mikrofon (B)"
              active={routing.b}
              onClick={() => routing.onB(!routing.b)}
              disabled={disabled}
            >
              <Mic2 />B
            </PadButton>
          </div>
        )}
        <PadButton
          title={muted ? "Stummschaltung aufheben" : "Stummschalten"}
          active={muted}
          tone="error"
          onClick={() => onMute(!muted)}
          disabled={disabled}
          className="w-full"
        >
          <VolumeX />
          {muted ? "STUMM" : "MUTE"}
        </PadButton>
        {footer}
      </div>
    </div>
  );
}
