import { fetchCommunes, groupMutations } from "../apis/dvf.js";
import { communesByDepartement } from "../apis/communes.js";
import { rentIndicator, RentKind, RENT_YEAR } from "../apis/loyers.js";
import { departementFromInsee } from "../util/geo.js";
import { median, round } from "../util/stats.js";
import { cleanPriceM2, locate, validYears } from "./shared.js";

/**
 * Budget search — the inverse of the estimator.
 *
 * "With 300 k€, where can I buy?" The estimator answers "what is this
 * dwelling worth"; this tool answers "which communes can this budget reach".
 * For every commune of a département it computes the median €/m² from actual
 * notarized sales, divides the budget by it (the surface the budget buys),
 * and layers the modelled asking rent on top for the yield.
 *
 * Honest by construction:
 *  - the budget is the purchase price only — acquisition fees (~6.4 %) are on
 *    top; `acquisition_costs` computes them once a dwelling is picked;
 *  - DVF only covers 2021 onward, so the median is a 4-year window at most;
 *  - communes are scanned most-populous-first up to `max_communes`: a wide
 *    search is a ranking, not an exhaustive sweep of 500 villages;
 *  - a commune whose sales are too thin is reported as "not enough data",
 *    never merged into the ranking.
 */

export interface SearchByBudgetOptions {
  /** Purchase budget in € — the price paid, fees excluded. */
  budget_eur: number;
  /** Dwelling type to search for. Absent: all single-dwelling sales. */
  type_local?: "Appartement" | "Maison";
  /** Commune name, INSEE code, address, or département code (e.g. "69"). */
  zone: string;
  /** Minimum surface the budget must buy for a commune to qualify (default 30). */
  min_surface_m2?: number;
  /** How many communes to scan, most populous first (default 15, max 40). */
  max_communes?: number;
}

export interface CommuneResult {
  insee_code: string;
  name: string;
  postcodes: string[];
  population: number | null;
  price: {
    median_eur_m2_last_12m: number | null;
    median_eur_m2_all_period: number | null;
    sales_last_12m: number;
    sales_all_period: number;
  };
  surface: { max_surface_m2: number | null };
  rent: {
    indicator_used: string;
    rent_eur_m2_month: number | null;
    estimated_monthly_rent_eur: number | null;
  };
  gross_yield_pct: number | null;
  /** True when the commune has usable sales but below the min surface. */
  below_min_surface: boolean;
}

export interface SearchByBudgetResult {
  budget_eur: number;
  type_local: "Appartement" | "Maison" | "tous types";
  zone: { input: string; resolved: string; departement: string; communes_scanned: number };
  years_used: number[];
  communes: CommuneResult[];
  rankings: {
    most_surface: number[];
    best_gross_yield_pct: number[];
    cheapest_eur_m2: number[];
  };
  not_enough_data: { insee_code: string; name: string; sales: number }[];
  errors: { insee_code: string; name: string; reason: string }[];
  note: string;
  caveats: string[];
}

const MIN_POPULATION = 500;
const DVF_WINDOW_YEARS = 4; // the scan covers the last 4 published years

function round0(v: number): number {
  return round(v, 0) ?? 0;
}

function round1(v: number): number {
  return round(v, 1) ?? 0;
}

interface Zone {
  citycode: string | null;
  departement: string;
  label: string;
}

async function resolveZone(zone: string): Promise<Zone> {
  const q = zone.trim();
  // A 5-character INSEE code (arrondissement level inside Paris/Lyon/Marseille).
  if (/^\d[0-9AB]\d{3}$/i.test(q)) {
    const citycode = q.toUpperCase();
    return { citycode, departement: departementFromInsee(citycode), label: `INSEE ${citycode}` };
  }
  // A bare 2–3 character code is a département, not a commune.
  if (/^\d{2,3}$/.test(q)) {
    return { citycode: null, departement: q, label: `Département ${q}` };
  }
  const { geo } = await locate(q);
  const citycode = geo.citycode;
  if (!citycode) throw new Error(`Could not resolve a commune for "${q}".`);
  return { citycode, departement: departementFromInsee(citycode), label: geo.label };
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function pooled<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CommuneMarket {
  medianLast12: number | null;
  medianAll: number | null;
  salesLast12: number;
  salesAll: number;
}

async function communeMarket(
  insee: string,
  years: number[],
  type: "Appartement" | "Maison" | undefined,
): Promise<CommuneMarket | null> {
  const rows = await fetchCommunes([insee], years);
  const mutations = groupMutations(rows).filter(cleanPriceM2);
  const typed =
    type === undefined ? mutations : mutations.filter((m) => m.dwellings[0]?.type === type);
  if (typed.length === 0) return null;

  const all = typed.map((m) => m.priceM2!);
  const latestDate = typed.reduce((acc, m) => (m.date > acc ? m.date : acc), "");
  const cutoff = new Date(Date.parse(latestDate) - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recent = typed.filter((m) => m.date >= cutoff).map((m) => m.priceM2!);

  return {
    medianLast12: recent.length > 0 ? median(recent) : null,
    medianAll: median(all),
    salesLast12: recent.length,
    salesAll: typed.length,
  };
}

export async function searchByBudget(args: SearchByBudgetOptions): Promise<SearchByBudgetResult> {
  if (!Number.isFinite(args.budget_eur) || args.budget_eur <= 0) {
    throw new Error("budget_eur must be a positive number.");
  }
  if (!args.zone || args.zone.trim() === "") {
    throw new Error("zone is required: a commune name, an INSEE code, an address, or a département code.");
  }
  const minSurface = args.min_surface_m2 ?? 30;
  const maxCommunes = Math.min(args.max_communes ?? 15, 40);

  const zone = await resolveZone(args.zone);
  const communes = await communesByDepartement(zone.departement);
  if (communes.length === 0) {
    throw new Error(`No commune found for département ${zone.departement}.`);
  }

  // Most populous first, so a wide search scans where the market actually is.
  const pool = communes.filter((c) => (c.population ?? 0) >= MIN_POPULATION).slice(0, maxCommunes);

  const allYears = validYears();
  const years = allYears.slice(-DVF_WINDOW_YEARS);
  const rentKind: RentKind = args.type_local === "Maison" ? "house" : "apartment";

  const communesOut: CommuneResult[] = [];
  const notEnoughData: SearchByBudgetResult["not_enough_data"] = [];
  const errors: SearchByBudgetResult["errors"] = [];

  await pooled(pool, 6, async (c) => {
    try {
      const market = await communeMarket(c.code, years, args.type_local);
      if (!market) {
        notEnoughData.push({ insee_code: c.code, name: c.nom, sales: 0 });
        return;
      }
      const price = market.medianLast12 ?? market.medianAll;
      if (price === null || price <= 0) {
        notEnoughData.push({ insee_code: c.code, name: c.nom, sales: market.salesAll });
        return;
      }
      const maxSurface = Math.floor(args.budget_eur / price);

      const hit = await rentIndicator(c.code, rentKind).catch(() => null);
      const rentM2 = hit?.rentM2 ?? null;
      const monthlyRent = rentM2 === null ? null : rentM2 * maxSurface;
      const grossYield = monthlyRent === null ? null : round1((monthlyRent * 12 * 100) / args.budget_eur);

      if (maxSurface < minSurface) {
        notEnoughData.push({ insee_code: c.code, name: c.nom, sales: market.salesAll });
        return;
      }

      communesOut.push({
        insee_code: c.code,
        name: c.nom,
        postcodes: c.codesPostaux ?? [],
        population: c.population ?? null,
        price: {
          median_eur_m2_last_12m: market.medianLast12 === null ? null : round0(market.medianLast12),
          median_eur_m2_all_period: round0(market.medianAll ?? 0),
          sales_last_12m: market.salesLast12,
          sales_all_period: market.salesAll,
        },
        surface: { max_surface_m2: maxSurface },
        rent: {
          indicator_used: rentKind,
          rent_eur_m2_month: rentM2 === null ? null : round1(rentM2),
          estimated_monthly_rent_eur: monthlyRent === null ? null : round0(monthlyRent),
        },
        gross_yield_pct: grossYield,
        below_min_surface: false,
      });
    } catch (e) {
      errors.push({
        insee_code: c.code,
        name: c.nom,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // Rank only the communes that qualify; a failed or thin commune is absent
  // from a ranking — unknown, never worst.
  const withSurface = communesOut
    .map((r, i) => ({ i, v: r.surface.max_surface_m2 ?? 0 }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.i);
  const withYield = communesOut
    .map((r, i) => ({ i, v: r.gross_yield_pct }))
    .filter((x): x is { i: number; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.i);
  const withPrice = communesOut
    .map((r, i) => ({ i, v: r.price.median_eur_m2_last_12m ?? r.price.median_eur_m2_all_period }))
    .filter((x): x is { i: number; v: number } => x.v !== null && x.v > 0)
    .sort((a, b) => a.v - b.v)
    .map((x) => x.i);

  return {
    budget_eur: round0(args.budget_eur),
    type_local: args.type_local ?? "tous types",
    zone: {
      input: zone.label,
      resolved: zone.citycode ?? zone.label,
      departement: zone.departement,
      communes_scanned: pool.length,
    },
    years_used: years,
    communes: communesOut,
    rankings: {
      most_surface: withSurface,
      best_gross_yield_pct: withYield,
      cheapest_eur_m2: withPrice,
    },
    not_enough_data: notEnoughData,
    errors,
    note: "Rankings are arrays of indices into communes: 0 is the first qualifying commune. A commune absent from a ranking has no usable figure for it — unknown, never worst. max_surface_m2 is budget ÷ median €/m² (the surface the budget buys before fees); gross_yield_pct prices that surface at the modelled asking rent.",
    caveats: [
      "The budget is the purchase price only: acquisition fees (about 6.4 %) come on top — run acquisition_costs on the chosen dwelling.",
      `Only the last ${DVF_WINDOW_YEARS} published DVF years are scanned (${years[0]}–${years[years.length - 1]}); the last-12-months median falls back to the all-period median when a commune has no recent sale.`,
      `At most ${maxCommunes} communes are scanned, most populous first: a wide search is a ranking, not an exhaustive sweep of the ${communes.length} communes of the département.`,
      "Rents are modelled asking rents (charges included) from the Carte des loyers, not regulated reference rents.",
      "This is public-data analysis, not investment advice.",
    ],
  };
}

