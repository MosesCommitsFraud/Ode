import { useRef, type PointerEvent } from "react";
import { cn } from "~/lib/utils";

/**
 * Wellenform als Balken. Mit `trim` lassen sich Anfang und Ende an zwei
 * Griffen ziehen; `progress` zeigt die Abspielposition.
 */
export function Waveform({
  peaks,
  color,
  progress,
  trim,
  className,
}: {
  peaks: number[];
  color: string;
  progress?: number;
  trim?: {
    start: number;
    end: number;
    onChange: (start: number, end: number) => void;
  };
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);
  const start = trim?.start ?? 0;
  const end = trim?.end ?? 1;

  const fraction = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!trim || e.button !== 0) return;
    const f = fraction(e.clientX);
    dragging.current = Math.abs(f - start) <= Math.abs(f - end) ? "start" : "end";
    e.currentTarget.setPointerCapture(e.pointerId);
    onPointerMove(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!trim || !dragging.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const f = fraction(e.clientX);
    if (dragging.current === "start") trim.onChange(Math.min(f, end - 0.01), end);
    else trim.onChange(start, Math.max(f, start + 0.01));
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = null)}
      className={cn("relative flex items-center gap-px", trim && "cursor-ew-resize touch-none", className)}
    >
      {peaks.map((p, i) => {
        const pos = i / peaks.length;
        const inside = pos >= start && pos <= end;
        const played = progress !== undefined && pos <= start + progress * (end - start);
        return (
          <span
            key={i}
            className="min-h-px flex-1 rounded-full transition-opacity"
            style={{
              height: `${Math.max(4, (p / 255) * 100)}%`,
              background: color,
              opacity: !inside ? 0.18 : played ? 1 : 0.55,
            }}
          />
        );
      })}
      {trim && progress !== undefined && (
        <span
          className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-sm bg-foreground shadow-[0_0_6px_var(--foreground)]"
          style={{ left: `${(start + progress * (end - start)) * 100}%` }}
        />
      )}
      {trim && (
        <>
          <Handle at={start} color={color} />
          <Handle at={end} color={color} />
        </>
      )}
    </div>
  );
}

function Handle({ at, color }: { at: number; color: string }) {
  return (
    <span
      className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full"
      style={{ left: `${at * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }}
    >
      <span
        className="absolute top-1/2 left-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-panel"
        style={{ background: color }}
      />
    </span>
  );
}
