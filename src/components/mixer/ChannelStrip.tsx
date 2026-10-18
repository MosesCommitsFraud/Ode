import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { cn, formatDb } from "~/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";

/**
 * Schalter im Kanalzug. An: gefüllt in der Kanalfarbe (`--ch`), bei
 * `tone="error"` rot. Aus: ruhig auf der vertieften Fläche.
 */
export function StripToggle({
  on,
  onClick,
  title,
  children,
  tone = "channel",
  disabled,
  className,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  tone?: "channel" | "error";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-0 flex-1 cursor-default items-center justify-center rounded-lg text-xs font-semibold transition-colors duration-150 disabled:opacity-40",
        on
          ? tone === "error"
            ? "bg-error text-white"
            : "bg-[var(--ch)] text-[oklch(18%_0.02_50)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Mehrere Schalter in einer gemeinsamen Mulde. */
export function ToggleGroup({ children }: { children: ReactNode }) {
  return <div className="well flex gap-1 rounded-xl p-1">{children}</div>;
}

export interface StripProps {
  name: string;
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
  /** Weitere Schalter, z. B. der Limiter der Ausgänge. */
  extra?: ReactNode;
  disabled?: boolean;
  /** Stellt Lautstärke, Mute, Routing und Limiter auf den Auslieferungszustand. */
  onReset: () => void;
  isDefault: boolean;
}

export function ChannelStrip({
  name,
  color,
  gainDb,
  muted,
  peak,
  onGain,
  onMute,
  routing,
  extra,
  disabled,
  onReset,
  isDefault,
}: StripProps) {
  const live = muted ? 0 : peak;

  return (
    <div
      style={{ "--ch": color } as CSSProperties}
      className={cn(
        "flex w-[calc((100vw-21rem)/6)] max-w-[10rem] min-w-[6.5rem] shrink-0 flex-col px-2.5 pt-2.5 pb-3",
        disabled && "opacity-55",
      )}
    >
      <div className="flex h-8 items-center gap-1.5">
        <span className="h-4 w-1 shrink-0 rounded-full bg-[var(--ch)]" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={name}>
          {name}
        </div>
        <button
          type="button"
          title="Auf Standard zurücksetzen"
          disabled={isDefault}
          onClick={onReset}
          className="flex size-7 shrink-0 cursor-default items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent [&_svg]:size-3.5"
        >
          <ArrowCounterClockwise />
        </button>
      </div>

      <button
        type="button"
        title={gainDb === 0 ? "Grundlautstärke 0 dB" : "Doppelklick auf den Fader oder hier: 0 dB"}
        disabled={disabled || gainDb === 0}
        onClick={() => onGain(0)}
        className={cn(
          "well mt-2 cursor-default rounded-lg py-1.5 text-center font-mono text-sm font-medium tabular-nums transition-colors",
          muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-foreground",
        )}
      >
        {muted ? "MUTE" : formatDb(gainDb)}
        {!muted && <span className="ml-1 text-3xs text-muted-foreground">dB</span>}
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

      <div>
        <ToggleGroup>
          {routing && (
            <>
              <StripToggle
                title="Auf Kopfhörer (A)"
                on={routing.a}
                onClick={() => routing.onA(!routing.a)}
                disabled={disabled}
              >
                A
              </StripToggle>
              <StripToggle
                title="Ins virtuelle Mikrofon (B)"
                on={routing.b}
                onClick={() => routing.onB(!routing.b)}
                disabled={disabled}
              >
                B
              </StripToggle>
            </>
          )}
          <StripToggle
            title={muted ? "Stummschaltung aufheben" : "Stummschalten"}
            on={muted}
            tone="error"
            onClick={() => onMute(!muted)}
            disabled={disabled}
          >
            M
          </StripToggle>
          {extra}
        </ToggleGroup>
      </div>
    </div>
  );
}
