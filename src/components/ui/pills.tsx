import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/*
 * Pillen-Gruppen in einer Mulde. PillGroup schiebt eine helle Markierung
 * unter die aktive Pille, wie bei Segmented und dem Hell/Dunkel-Schalter;
 * ActionGroup bündelt Knöpfe einer Seite im selben Look.
 */

export function PillGroup({
  children,
  className,
  size = "default",
}: {
  children: ReactNode;
  className?: string;
  /** `sm` für Umschalter innerhalb von Karten. */
  size?: "default" | "sm";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const active = root.querySelector<HTMLElement>('[data-active="true"]');
      setMark((prev) => {
        const next = active ? { left: active.offsetLeft, width: active.offsetWidth } : null;
        return prev?.left === next?.left && prev?.width === next?.width ? prev : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll("button").forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  });

  return (
    <div
      ref={ref}
      data-size={size}
      className={cn(
        "group/pills well relative flex items-center gap-0.5 rounded-full",
        size === "sm" ? "h-7 p-0.5" : "h-9 p-1",
        className,
      )}
    >
      {mark && (
        <span
          aria-hidden
          className={cn(
            "absolute left-0 rounded-full bg-panel-raised shadow-[0_1px_0_var(--hairline),0_4px_10px_-4px_oklch(0%_0_0/40%)] transition-[transform,width] duration-300 ease-drawer",
            size === "sm" ? "inset-y-0.5" : "inset-y-1",
          )}
          style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
        />
      )}
      {children}
    </div>
  );
}

export function Pill({ active, className, ...props }: ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      data-active={active}
      aria-pressed={active}
      className={cn(
        "relative flex h-7 cursor-default items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        "group-data-[size=sm]/pills:h-6 group-data-[size=sm]/pills:px-2.5 group-data-[size=sm]/pills:text-2xs",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ActionGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("well flex h-9 items-center gap-0.5 rounded-full p-1", className)}>{children}</div>;
}

/** Knopf in einer ActionGroup; `primary` ist die Hauptaktion der Seite. */
export function ActionPill({
  primary,
  className,
  ...props
}: ComponentProps<"button"> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 cursor-default items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        primary
          ? "bg-primary text-primary-foreground hover:brightness-110"
          : "text-muted-foreground hover:bg-panel-raised hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
