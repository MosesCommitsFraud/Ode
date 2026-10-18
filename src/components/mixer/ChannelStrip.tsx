import type { ReactNode } from "react";
import { Headphones, Mic2, Volume2, VolumeX } from "lucide-react";
import { cn, formatDb } from "~/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";

function ToggleChip({
  active,
  onClick,
  title,
  children,
  tone = "primary",
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  tone?: "primary" | "error";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-6 flex-1 cursor-default items-center justify-center gap-1 rounded-md border text-2xs font-medium transition-colors disabled:opacity-40 [&_svg]:size-3",
        active
          ? tone === "error"
            ? "border-error/30 bg-error/12 text-error-foreground"
            : "border-primary/30 bg-primary/12 text-primary"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface StripProps {
  name: string;
  icon: ReactNode;
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
  accent?: boolean;
}

export function ChannelStrip({
  name,
  icon,
  gainDb,
  muted,
  peak,
  onGain,
  onMute,
  routing,
  footer,
  disabled,
  accent,
}: StripProps) {
  return (
    <div
      className={cn(
        "flex w-[7.5rem] shrink-0 flex-col rounded-lg border border-border bg-card",
        accent && "bg-[color-mix(in_srgb,var(--card),var(--primary)_4%)]",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <span className="truncate text-xs font-medium">{name}</span>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-2 px-2 py-3">
        <Fader label={`${name} Lautstärke`} value={gainDb} onChange={onGain} disabled={disabled} />
        <div className="flex gap-0.5 py-2">
          <Meter peak={muted ? 0 : peak} />
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border p-2">
        <div className="text-center font-mono text-2xs text-muted-foreground tabular-nums">
          {formatDb(gainDb)} dB
        </div>
        {routing && (
          <div className="flex gap-1">
            <ToggleChip
              title="Auf Kopfhörer (A)"
              active={routing.a}
              onClick={() => routing.onA(!routing.a)}
              disabled={disabled}
            >
              <Headphones />A
            </ToggleChip>
            <ToggleChip
              title="Auf virtuelles Mikrofon (B)"
              active={routing.b}
              onClick={() => routing.onB(!routing.b)}
              disabled={disabled}
            >
              <Mic2 />B
            </ToggleChip>
          </div>
        )}
        <div className="flex gap-1">
          <ToggleChip
            title={muted ? "Stummschaltung aufheben" : "Stummschalten"}
            active={muted}
            tone="error"
            onClick={() => onMute(!muted)}
            disabled={disabled}
          >
            {muted ? <VolumeX /> : <Volume2 />}
            {muted ? "Stumm" : "Mute"}
          </ToggleChip>
        </div>
        {footer}
      </div>
    </div>
  );
}
