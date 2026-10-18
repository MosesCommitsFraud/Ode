import type { CSSProperties, ReactNode } from "react";
import { Headphones, MicrophoneStage as Mic2, ArrowCounterClockwise as RotateCcw, SpeakerSlash as VolumeX } from "@phosphor-icons/react";
import { cn, formatDb } from "~/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";

/** Taster wie auf einem Pult. */
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
        "relative flex h-8 flex-1 cursor-default items-center justify-center gap-1.5 rounded-xl font-mono text-2xs font-semibold transition-all duration-150 disabled:opacity-40 [&_svg]:size-3.5",
        active
          ? "bg-[color-mix(in_oklch,var(--pad)_18%,transparent)] text-[var(--pad)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--pad)_40%,transparent)_inset]"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface StripProps {
  name: string;
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
  /** Stellt Lautstärke, Mute, Routing und Limiter auf den Auslieferungszustand. */
  onReset: () => void;
  isDefault: boolean;
}

export function ChannelStrip({
  name,
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
  onReset,
  isDefault,
}: StripProps) {
  const live = muted ? 0 : peak;

  return (
    <div
      style={{ "--ch": color } as CSSProperties}
      className={cn("flex w-[calc((100vw-21rem)/6)] max-w-[10rem] min-w-[6.5rem] shrink-0 flex-col px-2.5 py-3.5", disabled && "opacity-55")}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--ch)_16%,transparent)] text-[var(--ch)] [&_svg]:size-4"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={name}>
          {name}
        </div>
        <button
          type="button"
          title="Auf Standard zurücksetzen"
          disabled={isDefault}
          onClick={onReset}
          className="flex size-7 shrink-0 cursor-default items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35 disabled:hover:bg-muted disabled:hover:text-muted-foreground [&_svg]:size-4"
        >
          <RotateCcw />
        </button>
      </div>

      <button
        type="button"
        title={gainDb === 0 ? "Grundlautstärke 0 dB" : "Auf 0 dB zurücksetzen"}
        disabled={disabled || gainDb === 0}
        onClick={() => onGain(0)}
        className={cn(
          "well group/db relative mt-3 cursor-default rounded-lg py-1.5 text-center font-mono text-sm font-medium tabular-nums transition-colors",
          muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-foreground",
        )}
      >
        {muted ? "MUTE" : formatDb(gainDb)}
        {!muted && <span className="ml-1 text-3xs text-muted-foreground">dB</span>}
        {gainDb !== 0 && !disabled && (
          <RotateCcw className="absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/db:opacity-100" />
        )}
      </button>

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
