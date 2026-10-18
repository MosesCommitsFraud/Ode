import type { ComponentProps, ReactNode } from "react";
import { cn } from "~/lib/utils";
import { EmptyArtwork, type EmptyArt } from "./empty";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 font-mono text-3xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "default",
  ...props
}: ComponentProps<"span"> & { tone?: "default" | "success" | "warning" | "error" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-mono text-3xs font-medium",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "success" && "bg-success/14 text-success-foreground",
        tone === "warning" && "bg-warning/14 text-warning-foreground",
        tone === "error" && "bg-error/14 text-error-foreground",
        tone === "primary" && "bg-primary/14 text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("panel rounded-2xl text-card-foreground", className)} {...props} />;
}

export function SectionLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("font-mono text-3xs tracking-[0.16em] text-muted-foreground uppercase", className)}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-default items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-primary" : "well",
      )}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/35%)] transition-transform duration-300 ease-drawer",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Auswahl mit gleitender Markierung, z. B. für die Puffergröße. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  format = String,
}: {
  value: T;
  onChange: (value: T) => void;
  options: T[];
  format?: (value: T) => ReactNode;
}) {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div className="well relative grid rounded-xl p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span
        className="absolute inset-y-1 left-1 rounded-lg bg-panel-raised shadow-[0_1px_0_var(--hairline),0_4px_10px_-4px_oklch(0%_0_0/40%)] transition-transform duration-300 ease-drawer"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "relative h-8 cursor-default font-mono text-xs tabular-nums transition-colors",
            o === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

/** Leere Seite: kleine Zeichnung, ein lockerer Satz, darunter optional ein Hinweis. */
export function EmptyState({
  art,
  title,
  children,
}: {
  art: EmptyArt;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <EmptyArtwork art={art} />
      <div className="space-y-1">
        <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
        {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}
