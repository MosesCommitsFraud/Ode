import { Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { EqChart, formatHz, withBand } from "~/components/effects/charts";
import { QuickPicks } from "~/components/effects/device";
import { PushButtons } from "~/components/ui/hardware";
import { Knob, parseNumber } from "~/components/ui/knob";
import { EMPTY_BAND, EQ_SLOTS } from "~/lib/defaults";
import type { BandShape, EqBand, EqSettings } from "~/lib/engine";
import { EQ_GAIN_LIMIT, maxQ } from "~/lib/filters";
import { t } from "~/lib/i18n";
import { cn, formatDb } from "~/lib/utils";

/*
 * Parametrischer EQ für Mikrofon und Kanäle: oben die Kurve, an der man
 * Bänder setzt und zieht, darunter Form und Drehregler des gewählten Bands
 * und rechts eine Schnellwahl fertiger Klangbilder.
 */

const SHAPES: BandShape[] = ["lowCut", "lowShelf", "bell", "highShelf", "highCut"];

const band = (shape: BandShape, freqHz: number, gainDb = 0, q = shape === "bell" ? 1 : 0.707): EqBand => ({ enabled: true, shape, freqHz, gainDb, q });

/** Schnellwahl: fertige Bänder, der Rest der Plätze bleibt frei. */
const PICKS: { label: string; bands: EqBand[] }[] = [
  { label: "devices.eq.neutral", bands: [] },
  { label: "devices.eq.warm", bands: [band("lowShelf", 150, 3), band("bell", 3000, -1.5, 0.8), band("highShelf", 9000, -2)] },
  { label: "devices.eq.clear", bands: [band("lowCut", 80), band("bell", 300, -2.5, 1.2), band("bell", 3000, 3, 0.9), band("highShelf", 10000, 2)] },
  { label: "devices.eq.bright", bands: [band("bell", 4000, 1.5, 0.8), band("highShelf", 8000, 4)] },
  { label: "devices.eq.thin", bands: [band("lowCut", 120), band("lowShelf", 250, -4)] },
];

const fill = (bands: EqBand[]) => Array.from({ length: EQ_SLOTS }, (_, i) => bands[i] ?? EMPTY_BAND);
const same = (a: EqBand[], b: EqBand[]) => JSON.stringify(a.filter((x) => x.enabled)) === JSON.stringify(b);

/** Bandbreite in Oktaven ↔ Güte einer Glocke. */
const qToOctaves = (q: number) => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
const octavesToQ = (bw: number) => 1 / (2 * Math.sinh((Math.LN2 / 2) * bw));
const round2 = (v: number) => Number(v.toFixed(2));

const parseHz = (text: string) => parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");
const isCut = (shape: BandShape) => shape === "lowCut" || shape === "highCut";

export const shapeName = (shape: BandShape) => t(`devices.eq.shape.${shape}`);

/** Gewähltes Band im EQ (Platz), anfangs keins. */
export function useEqTarget() {
  return useState<number | null>(null);
}

/** Die Kurve für den Diagramm-Platz der Geräte-Seite. */
export function EqGraph({
  eq,
  selected,
  onSelect,
  onChange,
  spectrumIn,
  spectrumOut,
}: {
  eq: EqSettings;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (patch: Partial<EqSettings>) => void;
  spectrumIn?: number[];
  spectrumOut?: number[];
}) {
  return (
    <EqChart
      eq={eq}
      name={(b) => shapeName(b.shape)}
      emptyText={t("devices.eq.empty")}
      selected={selected !== null && eq.bands[selected]?.enabled ? selected : null}
      onSelect={onSelect}
      onChange={onChange}
      spectrumIn={spectrumIn}
      spectrumOut={spectrumOut}
    />
  );
}

/** Form und Regler des gewählten Bands, daneben die Schnellwahl. */
export function EqControls({
  eq,
  selected,
  onSelect,
  onChange,
}: {
  eq: EqSettings;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (patch: Partial<EqSettings>) => void;
}) {
  const index = selected !== null && eq.bands[selected]?.enabled ? selected : null;
  const current = index !== null ? eq.bands[index] : null;
  const shown = current ?? EMPTY_BAND;
  const set = (patch: Partial<EqBand>) => index !== null && onChange({ bands: withBand(eq, index, patch) });
  const none = !current;
  const dash = (text: string) => (none ? "—" : text);

  return (
    <div className="flex min-w-0 flex-col gap-3 py-3">
      <div className="flex h-9 min-w-0 items-center gap-3">
        {current ? (
          <>
            <PushButtons
              className="max-w-2xl flex-1"
              value={current.shape}
              options={SHAPES.map((shape) => ({ value: shape, label: shapeName(shape) }))}
              onChange={(shape) => set({ shape, q: shape === "bell" ? (current.shape === "bell" ? current.q : 1) : 0.707 })}
            />
            <button
              type="button"
              onClick={() => {
                set({ enabled: false });
                onSelect(null);
              }}
              className="flex h-8 cursor-default items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            >
              <Trash /> {t("devices.eq.remove")}
            </button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t(eq.bands.some((b) => b.enabled) ? "devices.eq.pick" : "devices.eq.empty")}</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-6">
        <div className={cn("flex shrink-0 items-start gap-3 transition-opacity", none && "opacity-50")}>
          <Knob
            label={t("devices.eq.freq")}
            value={shown.freqHz}
            min={20}
            max={20_000}
            step={1}
            log
            disabled={none}
            reset={1000}
            format={(v) => dash(formatHz(v))}
            parse={parseHz}
            onChange={(freqHz) => set({ freqHz })}
          />
          <Knob
            label={t("devices.eq.gain")}
            value={shown.gainDb}
            min={-EQ_GAIN_LIMIT}
            max={EQ_GAIN_LIMIT}
            step={0.1}
            reset={0}
            bipolar
            disabled={none || isCut(shown.shape)}
            format={(v) => dash(isCut(shown.shape) ? "—" : `${formatDb(v)} dB`)}
            onChange={(gainDb) => set({ gainDb })}
          />
          {shown.shape === "bell" ? (
            <Knob
              label={t("devices.eq.width")}
              value={round2(qToOctaves(shown.q))}
              min={round2(qToOctaves(maxQ("bell")))}
              max={round2(qToOctaves(0.3))}
              step={0.01}
              log
              disabled={none}
              reset={round2(qToOctaves(1))}
              format={(v) => dash(`${v.toFixed(1)} ${t("devices.eq.octaves")}`)}
              onChange={(bw) => set({ q: Number(octavesToQ(bw).toFixed(3)) })}
            />
          ) : (
            <Knob
              label={t("devices.eq.slope")}
              value={shown.q}
              min={0.3}
              max={maxQ(shown.shape)}
              step={0.01}
              disabled={none}
              reset={0.707}
              format={(v) => dash(v.toFixed(2))}
              onChange={(q) => set({ q })}
            />
          )}
        </div>
        <span aria-hidden className="h-14 w-px shrink-0 bg-hairline" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("devices.quick")}</span>
          <QuickPicks
            options={PICKS.map((p) => ({ label: t(p.label), value: p.bands }))}
            isActive={(bands) => same(eq.bands, bands)}
            onPick={(bands) => {
              onChange({ bands: fill(bands) });
              onSelect(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
