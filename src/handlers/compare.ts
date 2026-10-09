import { pricePerM2 } from "./market.js";
import { dpeLookup } from "./context.js";
import { estimateProperty, rentEstimate } from "./valuation.js";
import { section } from "./shared.js";

/**
 * Side-by-side comparison of 2–5 addresses in one call.
 *
 * Each target fans out over market, valuation, rent and energy — the same
 * handlers the individual tools use, so the numbers cannot drift — but each
 * section is compacted to the figures a comparison needs, and a section that
 * fails degrades to `{ error }` without touching its neighbours. For depth on
 * one address, call that address's full tool afterwards.
 */

export interface CompareTarget {
  address: string;
  type_local?: "Appartement" | "Maison";
  surface_m2?: number;
  rooms?: number;
}

export interface CompareRow {
  input: { address: string; type_local: string | null; surface_m2: number | null; rooms: number | null };
  resolved_address: string | null;
  /** Compact market view: last-12-months median is the number to compare. */
  market: {
    median_eur_m2_last_12m: number | null;
    sales_last_12m: number | null;
    median_eur_m2_all_period: number | null;
  } | null;
  valuation: {
    value_eur: { estimate: number; low: number; high: number };
    confidence: "high" | "medium" | "low";
    comps_used: number;
    effective_sample_size: number;
    gross_yield_pct: number | null;
    net_yield_after_average_property_tax_pct: number | null;
  } | null;
  rent: {
    indicator_used: string;
    rent_eur_m2_month: number | null;
    estimated_monthly_rent_eur: number | null;
  } | null;
  energy: {
    energy_label: string | null;
    rental_status: "louable" | "bientot_interdit" | "interdit" | "inconnu";
    ban_date: string | null;
    is_passoire_thermique: boolean;
    annual_energy_cost_eur: number | null;
  } | null;
  /** Why a section is null — the row degrades, never the whole comparison. */
  errors: { market?: string; valuation?: string; rent?: string; energy?: string };
}

type Sectioned<T> = T | { error: string };

function hasError<T>(s: Sectioned<T>): s is { error: string } {
  return typeof s === "object" && s !== null && "error" in s;
}

/**
 * Compare one address: the same section handlers the individual tools use,
 * compacted to the figures a side-by-side needs. A section that fails is
 * recorded in `errors` and set to null — its neighbours are unaffected.
 */
async function compareOne(target: CompareTarget, radiusM: number): Promise<CompareRow> {
  const row: CompareRow = {
    input: {
      address: target.address,
      type_local: target.type_local ?? null,
      surface_m2: target.surface_m2 ?? null,
      rooms: target.rooms ?? null,
    },
    resolved_address: null,
    market: null,
    valuation: null,
    rent: null,
    energy: null,
    errors: {},
  };

  const market = await section(() =>
    pricePerM2({ address: target.address, type_local: target.type_local, radius_m: radiusM }),
  );
  if (hasError(market)) {
    row.errors.market = market.error;
  } else {
    const last12 = market.last_12_months as { median_eur_m2: number | null; sales: number } | null;
    row.market = {
      median_eur_m2_last_12m: last12?.median_eur_m2 ?? null,
      sales_last_12m: last12?.sales ?? null,
      median_eur_m2_all_period: market.all_period.median_eur_m2,
    };
    row.resolved_address = market.query.resolved_address;
  }

  if (target.type_local !== undefined && target.surface_m2 !== undefined) {
    const v = await section(() =>
      estimateProperty({
        address: target.address,
        type_local: target.type_local!,
        surface_m2: target.surface_m2!,
        rooms: target.rooms,
      }),
    );
    if (hasError(v)) {
      row.errors.valuation = v.error;
    } else {
      const vRental = v.rental as {
        gross_yield_pct?: number;
        net_yield_after_average_property_tax_pct?: number;
      } | null;
      row.valuation = {
        value_eur: v.estimate.value_eur,
        confidence: v.estimate.confidence,
        comps_used: v.estimate.comps_used,
        effective_sample_size: v.estimate.effective_sample_size,
        gross_yield_pct: vRental?.gross_yield_pct ?? null,
        net_yield_after_average_property_tax_pct: vRental?.net_yield_after_average_property_tax_pct ?? null,
      };
    }
  }

  const rent = await section(() => rentEstimate({ location: target.address, surface_m2: target.surface_m2 }));
  if (hasError(rent)) {
    row.errors.rent = rent.error;
  } else {
    // One indicator per dwelling type; without a type the apartment-wide
    // figure is the least wrong default and says so via indicator_used.
    const kind = target.type_local === "Maison" ? "house" : "apartment";
    const hit = rent.indicators[kind] as
      | { rent_eur_m2_month: number; estimated_monthly_rent_eur?: number }
      | null
      | undefined;
    row.rent = {
      indicator_used: kind,
      rent_eur_m2_month: hit?.rent_eur_m2_month ?? null,
      estimated_monthly_rent_eur: hit?.estimated_monthly_rent_eur ?? null,
    };
  }

  const energy = await section(() => dpeLookup({ address: target.address, limit: 1 }));
  if (hasError(energy)) {
    row.errors.energy = energy.error;
  } else {
    // Diagnostics come newest-first per register; the first row is the
    // most recent existing-dwelling DPE, the one the law looks at.
    const dpe = energy.diagnostics[0] as
      | {
          etiquette_dpe?: string;
          rental_compliance?: {
            energy_label: string | null;
            rental_status: "louable" | "bientot_interdit" | "interdit" | "inconnu";
            ban_date: string | null;
            is_passoire_thermique: boolean;
          };
          annual_energy_cost?: { annual_cost_eur: number } | null;
        }
      | undefined;
    row.energy = {
      energy_label: dpe?.rental_compliance?.energy_label ?? dpe?.etiquette_dpe ?? null,
      rental_status: dpe?.rental_compliance?.rental_status ?? "inconnu",
      ban_date: dpe?.rental_compliance?.ban_date ?? null,
      is_passoire_thermique: dpe?.rental_compliance?.is_passoire_thermique ?? false,
      annual_energy_cost_eur: dpe?.annual_energy_cost?.annual_cost_eur ?? null,
    };
  }

  return row;
}

/**
 * Rankings as row indices, so a client maps them back to `rows` without
 * string-matching addresses. Rows whose figure is missing (a failed section,
 * a commune with no sales) are simply absent from that ranking — never ranked
 * last, which would read as "worst" instead of "unknown".
 */
export function buildRankings(rows: CompareRow[]): {
  cheapest_eur_m2: number[];
  best_gross_yield_pct: number[];
} {
  const withPrice = rows
    .map((row, i) => ({ i, price: row.market?.median_eur_m2_last_12m ?? null }))
    .filter((x): x is { i: number; price: number } => x.price !== null)
    .sort((a, b) => a.price - b.price);

  const withYield = rows
    .map((row, i) => ({ i, y: row.valuation?.gross_yield_pct ?? null }))
    .filter((x): x is { i: number; y: number } => x.y !== null)
    .sort((a, b) => b.y - a.y);

  return {
    cheapest_eur_m2: withPrice.map((x) => x.i),
    best_gross_yield_pct: withYield.map((x) => x.i),
  };
}

export async function compareProperties(args: { targets: CompareTarget[]; radius_m?: number }) {
  const targets = args.targets;
  if (targets.length < 2) {
    throw new Error("compare_properties needs at least 2 targets — use the dedicated tools for a single address.");
  }
  const radiusM = args.radius_m ?? 500;

  const rows: CompareRow[] = await Promise.all(targets.map((target) => compareOne(target, radiusM)));

  return {
    source:
      "DVF (DGFiP/Etalab), Carte des loyers (Min. Logement/ANIL), ADEME DPE — official French open data, queried live.",
    query: {
      targets_count: targets.length,
      radius_m: radiusM,
    },
    rows,
    rankings: buildRankings(rows),
    note: "Rankings are arrays of row indices: 0 is your first target. A row absent from a ranking has no usable figure for it (failed section or no data), which means unknown — never worst. median_eur_m2_last_12m is the current market level; the all-period median mixes years. Gross yield comes from the comparables valuation (rent × 12 / estimated value), not from the asking-rent indicator alone.",
    caveats: [
      "One section failing never fails the comparison — read the row's `errors` before ranking on it.",
      "Rents are modelled asking rents (charges included), not regulated reference rents.",
      "The energy row uses the most recent DPE on file; several vintages may exist for one address (see dpe_lookup for the full list).",
      "This is public-data analysis, not a professional appraisal (avis de valeur).",
    ],
  };
}