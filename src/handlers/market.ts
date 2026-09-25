import { geocode } from "../apis/ban.js";
import { withinRadius, Mutation } from "../apis/dvf.js";
import { walkForwardBacktest } from "../backtest.js";
import { median, mean, quantile, round } from "../util/stats.js";
import { DVF_SOURCE, cleanPriceM2, loadMutations, locate, saleView, validYears } from "./shared.js";

export async function geocodeAddress(args: { query: string; limit?: number }) {
  const results = await geocode(args.query, args.limit ?? 5);
  return { source: "Base Adresse Nationale (BAN)", results };
}

export async function propertySales(args: {
  address: string;
  radius_m?: number;
  years?: number[];
  type_local?: "Appartement" | "Maison";
  min_surface_m2?: number;
  max_surface_m2?: number;
  limit?: number;
}) {
  const years = validYears(args.years);
  const located = await locate(args.address);
  const { geo, isPoint } = located;
  const radius = args.radius_m ?? 300;
  const limit = Math.min(args.limit ?? 30, 100);

  const { mutations: all, communes } = await loadMutations(located, radius, years);
  let mutations = all.filter((m) => m.nature === "Vente");

  if (isPoint) {
    mutations = mutations.filter((m) => withinRadius(m, geo.lat, geo.lon, radius));
  }
  if (args.type_local) {
    mutations = mutations.filter((m) => m.dwellings.some((d) => d.type === args.type_local));
  }
  if (args.min_surface_m2 !== undefined || args.max_surface_m2 !== undefined) {
    mutations = mutations.filter((m) => {
      const s = m.dwellings.reduce((acc, d) => acc + (d.surface ?? 0), 0);
      if (s === 0) return false;
      if (args.min_surface_m2 !== undefined && s < args.min_surface_m2) return false;
      if (args.max_surface_m2 !== undefined && s > args.max_surface_m2) return false;
      return true;
    });
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      scope: isPoint
        ? `within ${radius} m of the address (communes searched: ${communes.join(", ")})`
        : `whole commune (${geo.city}, insee ${geo.citycode})`,
      years,
    },
    total_matching_sales: mutations.length,
    sales: mutations.slice(0, limit).map(saleView),
    note:
      "price_per_m2 is only set when a deed covers exactly one dwelling; deeds bundling several units show the bundle price.",
  };
}

function statsBlock(values: number[]) {
  return {
    sales: values.length,
    median_eur_m2: round(median(values), 0),
    mean_eur_m2: round(mean(values), 0),
    p25_eur_m2: round(quantile(values, 0.25), 0),
    p75_eur_m2: round(quantile(values, 0.75), 0),
  };
}

export async function pricePerM2(args: {
  address: string;
  type_local?: "Appartement" | "Maison";
  years?: number[];
  radius_m?: number;
}) {
  const years = validYears(args.years);
  const located = await locate(args.address);
  const { geo, isPoint } = located;
  const radius = args.radius_m ?? 500;

  const { mutations: all, communes } = await loadMutations(located, radius, years);
  let mutations = all.filter(cleanPriceM2);
  if (isPoint) mutations = mutations.filter((m) => withinRadius(m, geo.lat, geo.lon, radius));
  if (args.type_local) {
    mutations = mutations.filter((m) => m.dwellings[0]?.type === args.type_local);
  }

  const overall = mutations.map((m) => m.priceM2!);
  const byYear: Record<string, unknown> = {};
  for (const y of years) {
    const ofYear = mutations.filter((m) => m.date.startsWith(String(y))).map((m) => m.priceM2!);
    if (ofYear.length > 0) {
      byYear[y] = { sales: ofYear.length, median_eur_m2: round(median(ofYear), 0) };
    }
  }

  // Trailing-12-months view: in a moving market, the all-period median
  // mixes 2021 and today's prices — this is the number to quote.
  const latestDate = mutations.reduce((acc, m) => (m.date > acc ? m.date : acc), "");
  let last12: unknown = null;
  if (latestDate) {
    const cutoff = new Date(Date.parse(latestDate) - 365 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const recent = mutations.filter((m) => m.date >= cutoff).map((m) => m.priceM2!);
    last12 = { window: `${cutoff} → ${latestDate}`, ...statsBlock(recent) };
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      scope: isPoint
        ? `within ${radius} m of the address (communes searched: ${communes.join(", ")})`
        : `whole commune (${geo.city}, insee ${geo.citycode})`,
      type_local: args.type_local ?? "Appartement + Maison",
      years,
    },
    all_period: statsBlock(overall),
    last_12_months: last12,
    by_year: byYear,
    note:
      "Computed from single-dwelling notarized sales only, outliers (<200 or >40 000 €/m²) excluded. Quote last_12_months for current market level.",
  };
}

export async function backtestEstimator(args: {
  address: string;
  type_local: "Appartement" | "Maison";
  from_year?: number;
  to_year?: number;
  max_points?: number;
}) {
  const located = await locate(args.address);
  const { geo } = located;
  if (geo.type !== "housenumber" && geo.type !== "street") {
    throw new Error(
      `"${args.address}" resolved to a ${geo.type}; a precise address (street or house number) is required for a backtest.`,
    );
  }

  const { mutations, communes } = await loadMutations(located, 2500, validYears());
  const report = walkForwardBacktest(mutations, {
    type: args.type_local,
    fromYear: args.from_year,
    toYear: args.to_year,
    maxPoints: args.max_points,
  });

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      type_local: args.type_local,
      communes_searched: communes,
      from_year: args.from_year ?? null,
      to_year: args.to_year ?? null,
    },
    ...report,
  };
}
