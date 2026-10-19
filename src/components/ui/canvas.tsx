import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { cn } from "~/lib/utils";

/*
 * Pixelgenaue Anzeigen. CSS-Streifen mit 2–3 px fallen bei 125 % oder 150 %
 * Windows-Skalierung zwischen die Bildschirmpixel und wirken unscharf. Hier
 * wird auf einer Canvas in echten Gerätepixeln gezeichnet: jede Strebe ist
 * eine ganze Zahl von Pixeln breit und sitzt genau auf dem Raster.
 */

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, el: HTMLCanvasElement) => void;

/** Canvas in Gerätepixeln; zeichnet neu bei Größenänderung und wenn `deps` sich ändern. */
function useCrispCanvas(draw: Draw, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const paint = () => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height, dpr } = size.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (width > 0 && height > 0) drawRef.current(ctx, width, height, dpr, canvas);
  };

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = (entry?: ResizeObserverEntry) => {
      const dpr = window.devicePixelRatio || 1;
      const box = entry?.devicePixelContentBoxSize?.[0];
      const rect = canvas.getBoundingClientRect();
      size.current = {
        width: box ? box.inlineSize : Math.round(rect.width * dpr),
        height: box ? box.blockSize : Math.round(rect.height * dpr),
        dpr,
      };
      paint();
    };
    measure();
    const observer = new ResizeObserver(([entry]) => measure(entry));
    try {
      observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      observer.observe(canvas);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Farben hängen am Theme; bei einem Wechsel neu zeichnen.
  useEffect(() => {
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(paint, deps);
  return ref;
}

/** Liest eine Farbe aus einer CSS-Variablen am Element, z. B. `--ch`. */
export function cssColor(el: Element, name: string, fallback = "#888") {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Ganze Gerätepixel für eine Länge in CSS-Pixeln, mindestens 1. */
function px(css: number, dpr: number) {
  return Math.max(1, Math.round(css * dpr));
}

export type LedColor = "on" | "warning" | "error" | "off" | "dim" | string;

/**
 * LED-Kette. `color(pos)` bekommt die Mitte eines Segments (0 = Anfang,
 * 1 = Ende) und liefert dessen Farbe: "on" (Kanalfarbe aus `--ch`),
 * "warning", "error", "off" oder einen eigenen CSS-Farbwert.
 */
export function LedBar({
  orientation = "horizontal",
  color,
  marker,
  segment = 3,
  gap = 2,
  deps,
  className,
  style,
}: {
  orientation?: "horizontal" | "vertical";
  color: (pos: number) => LedColor;
  /** Querstrich an dieser Stelle (0–1), z. B. für die gehaltene Spitze. */
  marker?: number | null;
  segment?: number;
  gap?: number;
  deps: unknown[];
  className?: string;
  style?: CSSProperties;
}) {
  const vertical = orientation === "vertical";
  const ref = useCrispCanvas(
    (ctx, width, height, dpr, el) => {
      const on = px(segment, dpr);
      const space = px(gap, dpr);
      const length = vertical ? height : width;
      const across = vertical ? width : height;
      const count = Math.max(1, Math.floor((length + space) / (on + space)));
      // Rest gleichmäßig an beiden Enden, damit die Kette mittig sitzt.
      const offset = Math.floor((length - (count * (on + space) - space)) / 2);
      const palette: Record<string, string> = {
        on: cssColor(el, "--ch", cssColor(el, "--success")),
        warning: cssColor(el, "--warning"),
        error: cssColor(el, "--error"),
        off: cssColor(el, "--led-off"),
        dim: cssColor(el, "--muted-foreground"),
      };
      for (let i = 0; i < count; i++) {
        const start = offset + i * (on + space);
        const c = color((start + on / 2) / length);
        ctx.fillStyle = palette[c] ?? c;
        if (vertical) ctx.fillRect(0, height - start - on, across, on);
        else ctx.fillRect(start, 0, on, across);
      }
      if (marker != null && marker > 0.01) {
        const line = px(2, dpr);
        const at = Math.min(length - line, Math.round(marker * length));
        ctx.fillStyle = cssColor(el, "--foreground");
        if (vertical) ctx.fillRect(0, height - at - line, across, line);
        else ctx.fillRect(at, 0, line, across);
      }
    },
    [...deps, marker, orientation, segment, gap],
  );
  return <canvas ref={ref} className={cn("block", className)} style={style} />;
}

/**
 * Balken nebeneinander, z. B. Wellenform oder Verlauf. Die Werte (0–1) werden
 * auf so viele Balken verteilt, wie in ganzen Pixeln hineinpassen.
 */
export function Bars({
  values,
  color,
  align = "center",
  bar = 2,
  gap = 1,
  min = 0.04,
  stretch = false,
  deps,
  className,
}: {
  values: number[];
  /** Farbe des Balkens an Position 0–1; mit Deckkraft als zweitem Wert. */
  color: (pos: number, value: number, el: HTMLCanvasElement) => [string, number];
  align?: "center" | "bottom";
  bar?: number;
  gap?: number;
  /** Mindesthöhe als Anteil, damit stille Stellen sichtbar bleiben. */
  min?: number;
  /** Genau ein Balken pro Wert; die Balken werden breiter, statt Werte zu wiederholen. */
  stretch?: boolean;
  deps: unknown[];
  className?: string;
}) {
  const ref = useCrispCanvas(
    (ctx, width, height, dpr, el) => {
      if (values.length === 0) return;
      const space = px(gap, dpr);
      let w = px(bar, dpr);
      let count = Math.max(1, Math.floor((width + space) / (w + space)));
      if (stretch && count > values.length) {
        count = values.length;
        w = Math.max(1, Math.floor((width + space) / count) - space);
      }
      const offset = Math.floor((width - (count * (w + space) - space)) / 2);
      for (let i = 0; i < count; i++) {
        // Spitzenwert des Abschnitts, der auf diesen Balken fällt.
        const from = Math.floor((i / count) * values.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / count) * values.length));
        let v = 0;
        for (let j = from; j < to && j < values.length; j++) v = Math.max(v, values[j]);
        const h = Math.max(px(min * height / dpr, dpr), Math.round(Math.min(1, v) * height));
        const [fill, alpha] = color((i + 0.5) / count, v, el);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        const x = offset + i * (w + space);
        const y = align === "bottom" ? height - h : Math.round((height - h) / 2);
        ctx.fillRect(x, y, w, h);
      }
      ctx.globalAlpha = 1;
    },
    [values, stretch, ...deps],
  );
  return <canvas ref={ref} className={cn("block", className)} />;
}
