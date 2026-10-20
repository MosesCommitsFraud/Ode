/*
 * Frequenzgang der EQs für die Browser-Vorschau ohne Engine: Biquads nach
 * dem Audio-EQ-Cookbook mit denselben Formen, Frequenzen und Güten wie
 * src-tauri/src/audio/eq.rs. In der App kommt die Kurve exakt aus der
 * Engine (Befehl `eq_curve`).
 */

import type { BandShape, EqSettings } from "./engine";

const RATE = 48_000;

export type Shape = "lowShelf" | "peak" | "highShelf" | "lowPass" | "highPass";
type Coefs = [number, number, number, number, number];

function design(shape: Shape, freq: number, q: number, gainDb: number): Coefs {
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(Math.max(freq, 10), RATE * 0.49)) / RATE;
  const sin = Math.sin(w0);
  const cos = Math.cos(w0);
  const alpha = sin / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (shape) {
    case "peak":
      [b0, b1, b2, a0, a1, a2] = [1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a];
      break;
    case "lowShelf": {
      const k = 2 * Math.sqrt(a) * alpha;
      [b0, b1, b2, a0, a1, a2] = [
        a * (a + 1 - (a - 1) * cos + k),
        2 * a * (a - 1 - (a + 1) * cos),
        a * (a + 1 - (a - 1) * cos - k),
        a + 1 + (a - 1) * cos + k,
        -2 * (a - 1 + (a + 1) * cos),
        a + 1 + (a - 1) * cos - k,
      ];
      break;
    }
    case "highShelf": {
      const k = 2 * Math.sqrt(a) * alpha;
      [b0, b1, b2, a0, a1, a2] = [
        a * (a + 1 + (a - 1) * cos + k),
        -2 * a * (a - 1 + (a + 1) * cos),
        a * (a + 1 + (a - 1) * cos - k),
        a + 1 - (a - 1) * cos + k,
        2 * (a - 1 - (a + 1) * cos),
        a + 1 - (a - 1) * cos - k,
      ];
      break;
    }
    case "lowPass":
      [b0, b1, b2, a0, a1, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "highPass":
      [b0, b1, b2, a0, a1, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
      break;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Betrag des Biquads bei `freq` in dB: |H(e^jω)| aus den Koeffizienten. */
function responseDb([b0, b1, b2, a1, a2]: Coefs, freq: number) {
  const w = (2 * Math.PI * freq) / RATE;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = b0 + b1 * c1 + b2 * c2;
  const numIm = -(b1 * s1 + b2 * s2);
  const denRe = 1 + a1 * c1 + a2 * c2;
  const denIm = -(a1 * s1 + a2 * s2);
  const mag = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  return 20 * Math.log10(Math.max(mag, 1e-9));
}

/** Regelweg der Bänder je Richtung (eq.rs `GAIN_LIMIT_DB`). */
export const EQ_GAIN_LIMIT = 15;
/** Höhe der EQ-Anzeige je Richtung: etwas mehr als der Regelweg. */
export const EQ_RANGE_DB = 18;
const SHAPES: Record<BandShape, Shape> = { bell: "peak", lowShelf: "lowShelf", highShelf: "highShelf", lowCut: "highPass", highCut: "lowPass" };

/** Größte Güte einer Form (eq.rs `max_q`): Glocken bis 10, sonst bis 2. */
export const maxQ = (shape: BandShape) => (shape === "bell" ? 10 : 2);

/** Gesamter Frequenzgang des EQs in dB an den Frequenzen `freqs`. */
export function eqResponse(eq: EqSettings, freqs: number[]) {
  const filters: Coefs[] = eq.bands.filter((b) => b.enabled).map((b) => design(SHAPES[b.shape], b.freqHz, b.q, b.gainDb));
  return freqs.map((f) => filters.reduce((sum, c) => sum + responseDb(c, f), 0));
}

/** Frequenzen gleichmäßig auf der logarithmischen Achse. */
export function logFrequencies(count: number, low = 20, high = 20_000) {
  const ratio = Math.pow(high / low, 1 / (count - 1));
  return Array.from({ length: count }, (_, i) => low * Math.pow(ratio, i));
}

/** Wie src-tauri/src/audio/spectrum.rs: 120 Bänder von 20 Hz bis 20 kHz, Mitte je Band. */
export const SPECTRUM_BANDS = 120;
export const SPECTRUM_FLOOR = -100;
export const spectrumFrequencies = (() => {
  const ratio = Math.pow(20_000 / 20, 1 / SPECTRUM_BANDS);
  return Array.from({ length: SPECTRUM_BANDS }, (_, i) => 20 * Math.pow(ratio, i + 0.5));
})();
