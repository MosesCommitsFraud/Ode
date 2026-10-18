import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dbToPosition, MAX_DB, MIN_DB, positionToDb } from "~/components/mixer/Fader";
import { actions, useStore } from "~/lib/store";
import { Meter } from "~/components/mixer/Meter";
import { cn, formatDb } from "~/lib/utils";

/**
 * Schnellzugriff auf das, was rausgeht (Ausgang B, das Kabel): ein kleiner
 * Pult-Fader mit LED-Pegel darunter, das Symbol schaltet stumm.
 */
export function OutputVolume() {
  const out = useStore((s) => s.outputs.b);
  const peak = useStore((s) => (s.info ? (s.meters?.outB.peak ?? 0) : 0));
  const track = useRef<HTMLDivElement>(null);

  const pos = dbToPosition(out.gainDb);

  const setGain = (gainDb: number) => actions.setOutput("b", { gainDb });

  const update = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    setGain(positionToDb(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))));
  };

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setGain(Math.min(MAX_DB, out.gainDb + step));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setGain(Math.max(MIN_DB, out.gainDb - step));
    else if (e.key === "Home") setGain(0);
    else return;
    e.preventDefault();
  };

  const Icon = out.muted || out.gainDb <= MIN_DB ? VolumeX : out.gainDb < -12 ? Volume1 : Volume2;

  return (
    <div
      style={{ "--ch": "var(--ch-out)" } as CSSProperties}
      className="flex items-center gap-2 rounded-xl bg-sidebar-accent py-2 pr-3 pl-1.5"
    >
      <button
        type="button"
        title={out.muted ? "Ausgang wieder einschalten" : "Ausgang stummschalten"}
        onClick={() => actions.setOutput("b", { muted: !out.muted })}
        className={cn(
          "flex size-8 shrink-0 cursor-default items-center justify-center rounded-lg transition-colors hover:bg-accent [&_svg]:size-4",
          out.muted ? "text-error-foreground" : "text-foreground",
        )}
      >
        <Icon />
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Lautstärke Ausgang"
          aria-valuemin={MIN_DB}
          aria-valuemax={MAX_DB}
          aria-valuenow={out.gainDb}
          aria-valuetext={`${formatDb(out.gainDb)} dB`}
          title={`${formatDb(out.gainDb)} dB · Doppelklick: 0 dB`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={() => setGain(0)}
          onKeyDown={onKeyDown}
          className="group relative h-5 touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* 0-dB-Rille wie auf dem Pult */}
          <span
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-muted-foreground/50"
            style={{ left: `${dbToPosition(0) * 100}%` }}
          />
          <div className="well absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full" />
          <div
            className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-[var(--ch)]"
            style={{ width: `${pos * 100}%`, opacity: out.muted ? 0.35 : 1 }}
          />
          {/* Kappe, verkleinert vom Pult-Fader */}
          <div
            className={cn(
              "absolute top-1/2 h-[18px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-[4px] transition-transform duration-100 group-active:scale-95",
              "bg-[linear-gradient(to_right,oklch(98%_0.003_75),oklch(86%_0.006_75))] dark:bg-[linear-gradient(to_right,oklch(40%_0.006_60),oklch(26%_0.006_60))]",
              "shadow-[0_1px_0_oklch(100%_0_0/35%)_inset,0_3px_8px_-2px_oklch(0%_0_0/55%),0_0_0_1px_oklch(0%_0_0/18%)]",
            )}
            style={{ left: `${pos * 100}%` }}
          >
            <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-[var(--ch)]" />
          </div>
        </div>
        <Meter peak={out.muted ? 0 : peak} orientation="horizontal" className="h-1.5" />
      </div>
    </div>
  );
}
