import { describe, expect, it } from "vitest";
import {
  groupMetrics,
  summarizeBacktest,
  surfaceBand,
  walkForwardBacktest,
  BacktestObservation,
} from "../src/backtest.js";
import { Mutation } from "../src/apis/dvf.js";
import { estimateValue } from "../src/estimator.js";

function mutation(over: Partial<Mutation> & { priceM2: number; date?: string }): Mutation {
  const surface = over.dwellings?.[0]?.surface ?? 50;
  return {
    id: Math.random().toString(36).slice(2),
    date: "2024-03-01",
    nature: "Vente",
    price: over.priceM2 * surface,
    addresses: ["10 RUE TEST"],
    dwellings: [{ type: "Appartement", surface, rooms: 2 }],
    otherLocals: [],
    landSurface: null,
    lat: 45.76,
    lon: 4.83,
    priceM2: over.priceM2,
    ...over,
  } as Mutation;
}

const target = { lat: 45.76, lon: 4.83, type: "Appartement" as const, surfaceM2: 50 };

describe("surfaceBand", () => {
  it("buckets surfaces at the documented boundaries", () => {
    expect(surfaceBand(20)).toBe("lt35");
    expect(surfaceBand(35)).toBe("35_60");
    expect(surfaceBand(59.9)).toBe("35_60");
    expect(surfaceBand(60)).toBe("60_90");
    expect(surfaceBand(120)).toBe("90_140");
    expect(surfaceBand(300)).toBe("gte140");
  });
});

describe("estimateValue walk-forward cut-off", () => {
  it("ignores sales recorded after asOf (no look-ahead)", () => {
    const early = Array.from({ length: 6 }, () => mutation({ priceM2: 5000, date: "2023-01-01" }));
    const future = Array.from({ length: 20 }, () => mutation({ priceM2: 12000, date: "2025-01-01" }));

    const walkForward = estimateValue(target, [...early, ...future], {
      asOf: Date.parse("2023-06-01"),
    })!;
    expect(walkForward.per_m2.estimate).toBe(5000);

    // Without the cut-off the same data would leak the 2025 market level.
    const leaky = estimateValue(target, [...early, ...future])!;
    expect(leaky.per_m2.estimate).toBeGreaterThan(5000);
  });

  it("honours excludeIds so a sale is not its own comparable", () => {
    const comps = Array.from({ length: 6 }, () => mutation({ priceM2: 5000, date: "2024-06-01" }));
    const subject = mutation({ priceM2: 25000, date: "2024-06-01" });

    const withSelf = estimateValue(target, [...comps, subject])!;
    const withoutSelf = estimateValue(target, [...comps, subject], {
      excludeIds: new Set([subject.id]),
    })!;

    // The weighted median is deliberately robust to one outlier, so identity is
    // asserted on the comp set itself: the subject's own deed (1 250 000 €) must
    // disappear from the audit trail when it is excluded.
    const subjectPrice = 25000 * 50;
    expect(withSelf.comps_used).toBe(7);
    expect(withSelf.top_comps.some((c) => c.price_eur === subjectPrice)).toBe(true);
    expect(withoutSelf.comps_used).toBe(6);
    expect(withoutSelf.top_comps.some((c) => c.price_eur === subjectPrice)).toBe(false);
  });
});

describe("summarizeBacktest", () => {
  const obs = (over: Partial<BacktestObservation>): BacktestObservation => ({
    id: "x",
    date: "2024-01-01",
    surface_m2: 50,
    band: "35_60",
    actual_eur_m2: 5000,
    predicted_eur_m2: 5000,
    low_eur_m2: 4500,
    high_eur_m2: 5500,
    abs_pct_error: 0,
    signed_pct_error: 0,
    within_range: true,
    comps_used: 10,
    effective_sample_size: 8,
    confidence: "medium",
    ...over,
  });

  it("computes MAPE, bias and interval coverage", () => {
    const metrics = summarizeBacktest([
      obs({ abs_pct_error: 10, signed_pct_error: 10, within_range: true }),
      obs({ abs_pct_error: 20, signed_pct_error: 20, within_range: false }),
      obs({ abs_pct_error: 30, signed_pct_error: -30, within_range: true }),
      obs({ abs_pct_error: 0, signed_pct_error: 0, within_range: true }),
    ]);
    expect(metrics.observations).toBe(4);
    expect(metrics.mape_pct).toBe(15);
    expect(metrics.median_ape_pct).toBe(15);
    expect(metrics.bias_pct).toBe(0); // 10 + 20 - 30 + 0
    expect(metrics.interval_coverage_pct).toBe(75);
  });

  it("returns null metrics rather than a fake zero on empty input", () => {
    expect(summarizeBacktest([]).mape_pct).toBeNull();
  });
});

describe("walkForwardBacktest", () => {
  it("scores a stable market with near-zero error and no future leakage", () => {
    const flat2023 = Array.from({ length: 10 }, () => mutation({ priceM2: 5000, date: "2023-05-01" }));
    const flat2025 = Array.from({ length: 10 }, () => mutation({ priceM2: 8000, date: "2025-05-01" }));

    const report = walkForwardBacktest([...flat2023, ...flat2025], { type: "Appartement" });

    expect(report.evaluated).toBe(20);
    // A 2023 target able to see 2025 would be ~60 % off; it must not.
    expect(report.overall.mape_pct!).toBeLessThan(1);
    expect(report.overall.bias_pct!).toBe(0);
    expect(report.year_range).toEqual([2023, 2025]);
  });

  it("skips sales that have fewer than three comps before them", () => {
    const january = Array.from({ length: 3 }, () => mutation({ priceM2: 5000, date: "2024-01-01" }));
    const june = Array.from({ length: 6 }, () => mutation({ priceM2: 5000, date: "2024-06-01" }));

    const report = walkForwardBacktest([...january, ...june], { type: "Appartement" });
    // The three January sales each see only their two same-day peers.
    expect(report.skipped_not_estimable).toBe(3);
    expect(report.evaluated).toBe(6);
    expect(report.candidates).toBe(9);
  });

  it("respects the year window and the point cap", () => {
    const sales = [
      ...Array.from({ length: 5 }, () => mutation({ priceM2: 5000, date: "2023-05-01" })),
      ...Array.from({ length: 5 }, () => mutation({ priceM2: 6000, date: "2024-05-01" })),
      ...Array.from({ length: 5 }, () => mutation({ priceM2: 7000, date: "2025-05-01" })),
    ];

    const report = walkForwardBacktest(sales, { type: "Appartement", fromYear: 2024, maxPoints: 3 });
    expect(report.candidates).toBe(10); // 2024 + 2025
    expect(report.evaluated).toBe(3); // capped, most recent first
    expect(Object.keys(report.by_year)).not.toContain("2023");
  });

  it("groups metrics by surface band ignoring house sales", () => {
    const flats = Array.from({ length: 8 }, () =>
      mutation({ priceM2: 7000, dwellings: [{ type: "Appartement", surface: 30, rooms: 1 }] }),
    );
    const houses = Array.from({ length: 8 }, () =>
      mutation({ priceM2: 3000, dwellings: [{ type: "Maison", surface: 120, rooms: 5 }] }),
    );

    const report = walkForwardBacktest([...flats, ...houses], { type: "Appartement" });
    expect(report.candidates).toBe(8);
    expect(Object.keys(report.by_surface_band)).toEqual(["lt35"]);

    const grouped = groupMetrics(
      [
        { band: "35_60", abs_pct_error: 10, signed_pct_error: 10, within_range: true } as BacktestObservation,
        { band: "35_60", abs_pct_error: 20, signed_pct_error: -10, within_range: false } as BacktestObservation,
        { band: "gte140", abs_pct_error: 40, signed_pct_error: 40, within_range: true } as BacktestObservation,
      ],
      (o) => o.band,
    );
    expect(grouped["35_60"].observations).toBe(2);
    expect(grouped["35_60"].mape_pct).toBe(15);
    expect(grouped["gte140"].mape_pct).toBe(40);
  });
});