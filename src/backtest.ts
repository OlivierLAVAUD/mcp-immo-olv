import { Mutation } from "./apis/dvf.js";
import { estimateValue, isCandidate, Target } from "./estimator.js";
import { mean, median, quantile, round } from "./util/stats.js";

/**
 * Walk-forward backtest of the comparables estimator.
 *
 * Every eligible historical sale is re-estimated using **only the information
 * available on that sale's own date**: `estimateValue` is called with an
 * `asOf` cut-off (no comp and no market level recorded later can leak in) and
 * with the sale's own mutation excluded. The prediction is then compared to the
 * price the notary actually recorded.
 *
 * The point is not to make the estimator look good — it is to publish the two
 * numbers a valuation is actually judged on: how far off it is (MAPE) and
 * whether it flatters buyers or sellers (bias), plus whether its range means
 * anything (interval coverage).
 */

export const BACKTEST_METHOD =
  "Walk-forward: each eligible sale is re-estimated with only the sales recorded on or before its own date (asOf cut-off, own mutation excluded), then compared with the notarized price.";

export type SurfaceBand = "lt35" | "35_60" | "60_90" | "90_140" | "gte140";

export const SURFACE_BANDS: SurfaceBand[] = ["lt35", "35_60", "60_90", "90_140", "gte140"];

/** Surface band, in m², used to report error by property size. */
export function surfaceBand(surface: number): SurfaceBand {
  if (surface < 35) return "lt35";
  if (surface < 60) return "35_60";
  if (surface < 90) return "60_90";
  if (surface < 140) return "90_140";
  return "gte140";
}

export interface BacktestObservation {
  id: string;
  date: string;
  surface_m2: number;
  band: SurfaceBand;
  actual_eur_m2: number;
  predicted_eur_m2: number;
  low_eur_m2: number;
  high_eur_m2: number;
  abs_pct_error: number;
  signed_pct_error: number;
  within_range: boolean;
  comps_used: number;
  effective_sample_size: number;
  confidence: "high" | "medium" | "low";
}

export interface BacktestMetrics {
  observations: number;
  mape_pct: number | null;
  median_ape_pct: number | null;
  p90_ape_pct: number | null;
  /** Mean signed error: > 0 means the model over-estimates on average. */
  bias_pct: number | null;
  /** Share of actual prices inside the reported P25–P75 range. Ideal ≈ 50 %. */
  interval_coverage_pct: number | null;
}

export interface BacktestOptions {
  type: "Appartement" | "Maison";
  fromYear?: number;
  toYear?: number;
  /** Cap on evaluated sales; the most recent ones are kept. Default 250. */
  maxPoints?: number;
}

export interface BacktestReport {
  method: string;
  type: "Appartement" | "Maison";
  candidates: number;
  evaluated: number;
  skipped_not_estimable: number;
  year_range: [number, number] | null;
  overall: BacktestMetrics;
  by_surface_band: Record<string, BacktestMetrics>;
  by_year: Record<string, BacktestMetrics>;
  /** The ten largest absolute errors, to audit where the model breaks. */
  worst_cases: BacktestObservation[];
  caveats: string[];
}

const EMPTY_METRICS: BacktestMetrics = {
  observations: 0,
  mape_pct: null,
  median_ape_pct: null,
  p90_ape_pct: null,
  bias_pct: null,
  interval_coverage_pct: null,
};

export function summarizeBacktest(observations: BacktestObservation[]): BacktestMetrics {
  if (observations.length === 0) return { ...EMPTY_METRICS };
  const ape = observations.map((o) => o.abs_pct_error);
  const signed = observations.map((o) => o.signed_pct_error);
  const covered = observations.filter((o) => o.within_range).length;
  return {
    observations: observations.length,
    mape_pct: round(mean(ape)!, 1),
    median_ape_pct: round(median(ape)!, 1),
    p90_ape_pct: round(quantile(ape, 0.9)!, 1),
    bias_pct: round(mean(signed)!, 1),
    interval_coverage_pct: round((covered * 100) / observations.length, 1),
  };
}

/** Group observations and summarise each group (bands, years, communes…). */
export function groupMetrics(
  observations: BacktestObservation[],
  keyOf: (o: BacktestObservation) => string,
): Record<string, BacktestMetrics> {
  const groups = new Map<string, BacktestObservation[]>();
  for (const o of observations) {
    const key = keyOf(o);
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }
  const out: Record<string, BacktestMetrics> = {};
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[key] = summarizeBacktest(list);
  }
  return out;
}

/**
 * Replay every eligible sale as if it were being valued blind, and score the
 * result. `mutations` should be the widest set available for the area (all
 * years): the walk-forward cut-off — not the caller — decides what each
 * observation is allowed to see.
 */
export function walkForwardBacktest(mutations: Mutation[], options: BacktestOptions): BacktestReport {
  const maxPoints = Math.max(1, options.maxPoints ?? 250);

  const candidates = mutations
    .filter((m) => isCandidate(m, options.type))
    .filter((m) => m.lat !== null && m.lon !== null)
    .filter((m) => (m.dwellings[0].surface ?? 0) > 0)
    .filter((m) => {
      const year = Number(m.date.slice(0, 4));
      if (!Number.isFinite(year)) return false;
      if (options.fromYear !== undefined && year < options.fromYear) return false;
      if (options.toYear !== undefined && year > options.toYear) return false;
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // most recent first

  const observations: BacktestObservation[] = [];
  let skipped = 0;

  for (const mutation of candidates.slice(0, maxPoints)) {
    const surface = mutation.dwellings[0].surface!;
    const target: Target = {
      lat: mutation.lat!,
      lon: mutation.lon!,
      type: options.type,
      surfaceM2: surface,
    };
    const estimate = estimateValue(target, mutations, {
      asOf: Date.parse(mutation.date),
      excludeIds: new Set([mutation.id]),
    });
    if (!estimate) {
      skipped++;
      continue;
    }

    const actual = mutation.priceM2!;
    const predicted = estimate.per_m2.estimate;
    observations.push({
      id: mutation.id,
      date: mutation.date,
      surface_m2: surface,
      band: surfaceBand(surface),
      actual_eur_m2: round(actual, 0)!,
      predicted_eur_m2: predicted,
      low_eur_m2: estimate.per_m2.low,
      high_eur_m2: estimate.per_m2.high,
      abs_pct_error: round(Math.abs((predicted - actual) / actual) * 100, 2)!,
      signed_pct_error: round(((predicted - actual) / actual) * 100, 2)!,
      within_range: actual >= estimate.per_m2.low && actual <= estimate.per_m2.high,
      comps_used: estimate.comps_used,
      effective_sample_size: estimate.effective_sample_size,
      confidence: estimate.confidence,
    });
  }

  const years = observations.map((o) => Number(o.date.slice(0, 4))).filter((y) => Number.isFinite(y));
  const yearRange: [number, number] | null =
    years.length > 0 ? [Math.min(...years), Math.max(...years)] : null;

  const worstCases = [...observations].sort((a, b) => b.abs_pct_error - a.abs_pct_error).slice(0, 10);

  return {
    method: BACKTEST_METHOD,
    type: options.type,
    candidates: candidates.length,
    evaluated: observations.length,
    skipped_not_estimable: skipped,
    year_range: yearRange,
    overall: summarizeBacktest(observations),
    by_surface_band: groupMetrics(observations, (o) => o.band),
    by_year: groupMetrics(observations, (o) => String(Number(o.date.slice(0, 4)))),
    worst_cases: worstCases,
    caveats: [
      "interval_coverage_pct is measured against the estimator's own P25–P75 range: a well-calibrated range covers ≈ 50 % of realized sales, not 95 %.",
      "Only single-dwelling sales with a valid €/m², a surface and coordinates can be both a comp and a target; bundled deeds are excluded, and Alsace-Moselle / Mayotte are out of DVF scope.",
      "Bands and years with few observations are noisy — read every metric together with its observation count.",
      "This measures the model against DVF's own recorded prices, not against a professional appraisal (avis de valeur).",
    ],
  };
}
