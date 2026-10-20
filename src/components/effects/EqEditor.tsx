import { useState } from "react";
import { EqChart, formatHz, maxQ, withBand, type EqTarget } from "~/components/effects/charts";
import { QuickPicks } from "~/components/effects/device";
import { PushButtons } from "~/components/ui/hardware";
import { Knob, parseNumber } from "~/components/ui/knob";
import { EQ_DEFAULTS } from "~/lib/defaults";
import type { EqSettings } from "~/lib/engine";
import { bandShape, EQ_GAIN_LIMIT, HIGH_CUT_OFF, LOW_CUT_OFF } from "~/lib/filters";
import { t } from "~/lib/i18n";
import { formatDb } from "~/lib/utils";

/*
 * Parametrischer EQ für Mikrofon und Kanäle: oben die Kurve zum Ziehen,
 * darunter die Wahl des Punkts (Low-Cut, fünf Bänder, High-Cut) und seine
 * Drehregler, rechts eine Schnellwahl fertiger Klangbilder.
 */

const TARGETS: EqTarget[] = ["lowCut", 0, 1, 2, 3, 4, "highCut"];

/** Schnellwahl: Verstärkung je Band bei den Grundfrequenzen. */
const PICKS: { label: string; gains: number[] }[] = [
  { label: "devices.eq.neutral", gains: [0, 0, 0, 0, 0] },
  { label: "devices.eq.warm", gains: [3, 1, 0, -1, -2] },
  { label: "devices.eq.clear", gains: [-2, -1, 0, 3, 2] },
  { label: "devices.eq.bright", gains: [0, 0, 0, 2, 4] },
  { label: "devices.eq.thin", gains: [-6, -2, 0, 0, 0] },
];

/** Schnellwahl für die Cuts: übliche Frequenzen, die erste ist „aus“. */
const CUT_PICKS = { lowCut: [LOW_CUT_OFF, 80, 120, 200], highCut: [HIGH_CUT_OFF, 12_000, 8_000, 5_000] };

/** Bandbreite in Oktaven ↔ Güte einer Glocke. */
const qToOctaves = (q: number) => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
const octavesToQ = (bw: number) => 1 / (2 * Math.sinh((Math.LN2 / 2) * bw));

const parseHz = (text: string) => parseNumber(text, /k/i.test(text) ? "kHz" : "Hz");

export const eqName = (target: EqTarget) => t(`devices.eq.band.${target}`);

/** Gewählter Punkt im EQ; beim Öffnen das mittlere Band. */
export function useEqTarget() {
  return useState<EqTarget>(2);
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
  selected: EqTarget;
  onSelect: (target: EqTarget) => void;
  onChange: (patch: Partial<EqSettings>) => void;
  spectrumIn?: number[];
  spectrumOut?: number[];
}) {
  return (
    <EqChart
      eq={eq}
      name={eqName}
      offText={t("mixer.cutOff")}
      selected={selected}
      onSelect={onSelect}
      onChange={onChange}
      spectrumIn={spectrumIn}
      spectrumOut={spectrumOut}
    />
  );
}

/** Wahl des Punkts, seine Regler und die Schnellwahl. */
export function EqControls({
  eq,
  selected,
  onSelect,
  onChange,
}: {
  eq: EqSettings;
  selected: EqTarget;
  onSelect: (target: EqTarget) => void;
  onChange: (patch: Partial<EqSettings>) => void;
}) {
  const count = eq.bands.length;
  const isDefault = (gains: number[]) =>
    eq.bands.every((b, i) => b.gainDb === gains[i] && b.freqHz === EQ_DEFAULTS.bands[i].freqHz && b.q === EQ_DEFAULTS.bands[i].q);

  let knobs;
  if (typeof selected === "number") {
    const band = eq.bands[selected];
    const set = (patch: Partial<typeof band>) => onChange({ bands: withBand(eq, selected, patch) });
    const bell = bandShape(selected, count) === "peak";
    knobs = (
      <>
        <Knob
          label={t("devices.eq.freq")}
          value={band.freqHz}
          min={20}
          max={20_000}
          step={1}
          log
          reset={EQ_DEFAULTS.bands[selected].freqHz}
          format={formatHz}
          parse={parseHz}
          onChange={(freqHz) => set({ freqHz })}
        />
        <Knob
          label={t("devices.eq.gain")}
          value={band.gainDb}
          min={-EQ_GAIN_LIMIT}
          max={EQ_GAIN_LIMIT}
          step={0.1}
          reset={0}
          bipolar
          format={(v) => `${formatDb(v)} dB`}
          onChange={(gainDb) => set({ gainDb })}
        />
        {bell ? (
          <Knob
            label={t("devices.eq.width")}
            value={Number(qToOctaves(band.q).toFixed(2))}
            min={Number(qToOctaves(maxQ(selected, count)).toFixed(2))}
            max={Number(qToOctaves(0.3).toFixed(2))}
            step={0.01}
            log
            reset={Number(qToOctaves(1).toFixed(2))}
            format={(v) => `${v.toFixed(1)} ${t("devices.eq.octaves")}`}
            onChange={(bw) => set({ q: Number(octavesToQ(bw).toFixed(3)) })}
          />
        ) : (
          <Knob
            label={t("devices.eq.slope")}
            value={band.q}
            min={0.3}
            max={maxQ(selected, count)}
            step={0.01}
            reset={0.707}
            format={(v) => v.toFixed(2)}
            onChange={(q) => set({ q })}
          />
        )}
      </>
    );
  } else {
    const low = selected === "lowCut";
    const value = low ? eq.lowCutHz : eq.highCutHz;
    const off = low ? value <= LOW_CUT_OFF : value >= HIGH_CUT_OFF;
    const set = (hz: number) => onChange(low ? { lowCutHz: hz } : { highCutHz: hz });
    knobs = (
      <>
        <Knob
          label={t("devices.eq.freq")}
          value={value}
          min={low ? LOW_CUT_OFF : 1_000}
          max={low ? 2_000 : HIGH_CUT_OFF}
          step={1}
          log
          reset={low ? LOW_CUT_OFF : HIGH_CUT_OFF}
          format={(v) => ((low ? v <= LOW_CUT_OFF : v >= HIGH_CUT_OFF) ? t("mixer.cutOff") : formatHz(v))}
          parse={parseHz}
          onChange={set}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 self-center">
          <span className="text-xs text-muted-foreground">{t(low ? "devices.tone.lowCut" : "devices.tone.highCut")}</span>
          <QuickPicks
            options={CUT_PICKS[selected].map((hz, i) => ({ label: i === 0 ? t("mixer.cutOff") : formatHz(hz), value: hz }))}
            isActive={(hz) => (hz === CUT_PICKS[selected][0] ? off : hz === value)}
            onPick={set}
          />
        </div>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 py-3">
      <PushButtons
        value={String(selected)}
        options={TARGETS.map((target) => ({ value: String(target), label: eqName(target) }))}
        onChange={(v) => onSelect(v === "lowCut" || v === "highCut" ? v : Number(v))}
      />
      <div className="flex min-w-0 items-center gap-6">
        {/* Feste Breite: beim Wechsel des Punkts springt die Schnellwahl nicht. */}
        <div className="flex w-[23rem] shrink-0 items-start gap-3">{knobs}</div>
        <span aria-hidden className="h-14 w-px shrink-0 bg-hairline" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("devices.quick")}</span>
          <QuickPicks
            options={PICKS.map((p) => ({ label: t(p.label), value: p.gains }))}
            isActive={isDefault}
            onPick={(gains) => onChange({ bands: EQ_DEFAULTS.bands.map((b, i) => ({ ...b, gainDb: gains[i] })) })}
          />
        </div>
      </div>
    </div>
  );
}
