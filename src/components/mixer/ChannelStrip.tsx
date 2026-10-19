import type { CSSProperties, ReactNode } from "react";
import { ArrowCounterClockwise as RotateCcw, Headphones, MicrophoneStage } from "@phosphor-icons/react";
import { cn, formatDb } from "~/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";
import { t } from "~/lib/i18n";

/**
 * Schalter im Stil der übrigen Auswahlen der App: in einer Mulde, eingeschaltet
 * hebt er sich als helle Fläche heraus und trägt die Kanalfarbe (`--ch`),
 * Stumm trägt Rot.
 */
export function StripToggle({
  on,
  onClick,
  title,
  children,
  tone = "channel",
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  tone?: "channel" | "error";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-0 flex-1 cursor-default items-center justify-center rounded-lg font-mono text-2xs font-semibold uppercase transition-all duration-200 disabled:opacity-40 [&_svg]:size-4",
        on
          ? cn(
              "bg-panel-raised shadow-[0_1px_0_var(--hairline),0_4px_10px_-4px_oklch(0%_0_0/40%)]",
              tone === "error" ? "text-error-foreground" : "text-[var(--ch)]",
            )
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ToggleGroup({ children }: { children: ReactNode }) {
  return <div className="well flex gap-1 rounded-xl p-1">{children}</div>;
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
  /** Weitere Schalter in derselben Mulde, z. B. der Limiter der Ausgänge. */
  extra?: ReactNode;
  disabled?: boolean;
  /** Stellt Lautstärke, Mute, Routing und Limiter auf den Auslieferungszustand. */
  onReset: () => void;
  isDefault: boolean;
  /** Ohne Name und Symbol, z. B. wenn die Seite den Kanal schon benennt. */
  hideName?: boolean;
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
  extra,
  disabled,
  onReset,
  isDefault,
  hideName,
}: StripProps) {
  const live = muted ? 0 : peak;
  const reset = (
    <button
      type="button"
      title={t("common.resetDefault")}
      disabled={isDefault}
      onClick={onReset}
      className="flex size-7 shrink-0 cursor-default items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground [&_svg]:size-4"
    >
      <RotateCcw />
    </button>
  );

  return (
    <div
      style={{ "--ch": color } as CSSProperties}
      className={cn("flex w-[calc((100vw-21rem)/6)] max-w-[10rem] min-w-[6.5rem] shrink-0 flex-col px-2.5 py-3.5", disabled && "opacity-55")}
    >
      {!hideName && (
        <div className="mb-3 flex items-center gap-1.5">
          <span className="flex shrink-0 items-center text-[var(--ch)] [&_svg]:size-[18px]">{icon}</span>
          <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={name}>
            {name}
          </div>
          {reset}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title={gainDb === 0 ? t("mixer.unityGain") : t("mixer.resetGain")}
          disabled={disabled || gainDb === 0}
          onClick={() => onGain(0)}
          className={cn(
            "well group/db relative min-w-0 flex-1 cursor-default rounded-lg py-1.5 text-center font-mono text-sm font-medium tabular-nums transition-colors",
            muted ? "text-error-foreground" : gainDb > 0 ? "text-[var(--ch)]" : "text-foreground",
          )}
        >
          {muted ? "MUTE" : formatDb(gainDb)}
          {!muted && <span className="ml-1 text-3xs text-muted-foreground">dB</span>}
          {gainDb !== 0 && !disabled && (
            <RotateCcw className="absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/db:opacity-100" />
          )}
        </button>
        {hideName && reset}
      </div>

      <div className="flex min-h-0 flex-1 justify-center">
        <Fader
          label={t("mixer.volumeOf", { name })}
          value={gainDb}
          onChange={onGain}
          disabled={disabled}
          meter={<Meter peak={live} className="my-0" />}
        />
      </div>

      <ToggleGroup>
        {routing && (
          <>
            <StripToggle
              title={t("mixer.toHeadphones")}
              on={routing.a}
              onClick={() => routing.onA(!routing.a)}
              disabled={disabled}
            >
              <Headphones />
            </StripToggle>
            <StripToggle
              title={t("mixer.toCable")}
              on={routing.b}
              onClick={() => routing.onB(!routing.b)}
              disabled={disabled}
            >
              <MicrophoneStage />
            </StripToggle>
          </>
        )}
        <StripToggle
          title={muted ? t("mixer.unmute") : t("mixer.mute")}
          on={muted}
          tone="error"
          onClick={() => onMute(!muted)}
          disabled={disabled}
        >
          Mute
        </StripToggle>
        {extra}
      </ToggleGroup>
    </div>
  );
}
