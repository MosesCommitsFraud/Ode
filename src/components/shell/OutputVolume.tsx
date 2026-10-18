import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { dbToPosition, MAX_DB, MIN_DB, positionToDb } from "~/components/mixer/Fader";
import { actions, useStore } from "~/lib/store";
import { cn, formatDb, gainToDb } from "~/lib/utils";

const FLOOR = -60;
const FALL_DB = 1.6;

/**
 * Schnellzugriff auf das, was rausgeht (Ausgang B, das Kabel): Pegel im
 * Regler, Ziehen ändert die Lautstärke, das Symbol schaltet stumm.
 */
export function OutputVolume() {
  const out = useStore((s) => s.outputs.b);
  const peak = useStore((s) => (s.info ? (s.meters?.outB.peak ?? 0) : 0));
  const track = useRef<HTMLDivElement>(null);
  const display = useRef(FLOOR);

  const db = gainToDb(out.muted ? 0 : peak, FLOOR);
  display.current = Math.max(db, display.current - FALL_DB);
  const level = Math.min(1, Math.max(0, (display.current - FLOOR) / -FLOOR));
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
    <div className="flex h-11 items-center gap-2 rounded-xl bg-sidebar-accent pr-3 pl-1.5">
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
        className="group relative h-5 flex-1 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="well absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
          {/* Eingestellte Lautstärke */}
          <div className="absolute inset-y-0 left-0 bg-foreground/25" style={{ width: `${pos * 100}%` }} />
          {/* Was gerade rausgeht */}
          <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(level, pos) * 100}%` }} />
        </div>
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/40%)] transition-transform group-active:scale-110"
          style={{ left: `${pos * 100}%` }}
        />
      </div>
    </div>
  );
}
