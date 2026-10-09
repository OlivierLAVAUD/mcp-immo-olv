import { round } from "../util/stats.js";
import { rentEstimate, estimateProperty } from "./valuation.js";
import { propertyTaxEstimate } from "./valuation.js";

/**
 * Acquisition costs simulator.
 *
 * Computes, for a French dwelling, the upfront costs of acquisition (legal
 * fees, notary fees, publication) and the first-year running costs (property
 * tax), plus the gross/net yields from a modelled asking rent.
 *
 * Scope and limits:
 *  - Rights of transfer (droits de mutation) follow the official 2026 scale:
 *    commune > 5 000 inhabitants: base 4.50 % + department 0.7163 % +
 *    commune 1.204 %, i.e. about 6.42 % (taxe incluse). Communes ≤ 5 000
 *    inhabitants are cheaper (no commune share).
 *  - Notary fees follow the standard "garantie civile" card (750 € per deed
 *    + 50 €/hour of work) — the entry-level offer. A "notaire en mains
 *    propres" typically costs 750–1 250 € total; an "agressive" bid 750 €.
 *  - The property tax is the official average per REI article for the
 *    commune — an aggregate indicator. It is NOT the individual tax notice.
 *  - Rents are modelled asking rents (charges included) from the Carte des
 *    loyers; they are NOT a regulated reference rent.
 *  - All figures are indicative and must be confirmed before any binding
 *    offer. Taxe foncière reported here is an average, never the bill.
 */

/** Rights of transfer scale, 2026 — communes with more than 5 000 inhabitants. */
const MUTATION_BASE_PCT = 4.5;
const MUTATION_DEPARTMENT_PCT = 0.7163;
const MUTATION_COMMUNE_PCT = 1.204;
const MUTATION_PCT = MUTATION_BASE_PCT + MUTATION_DEPARTMENT_PCT + MUTATION_COMMUNE_PCT; // 6.4203

/** Notary fee schedule (standard entry-level card, 2026). */
const NOTARY_ACTE_MIN = 750; // €, per deed, includes legal guarantee work
const NOTARY_HOURS = 0.5; // €/hour, standard card
const NOTARY_RATE = 100; // €/hour standard card

export interface AcquisitionCostsOptions {
  address: string;
  type_local: "Appartement" | "Maison";
  surface_m2: number;
  rooms?: number;
  /** Price in €, if known (negotiated or asking). If absent, a market estimate is used. */
  price_eur?: number;
  /** "estimate" (default) = use estimate_property; "agreed" = assume price_eur is signed; "asking" = use asking price. */
  price_from?: "estimate" | "agreed" | "asking";
  /** Tariff assumption for the energy cost of the dwelling, €/kWh (default 0.2562, early-2025 regulated tariff). */
  energy_price_eur_kwh?: number;
  /** Notary fee model: standard (typical), hands_off (owner performs work, lower fees), aggressive (best-case) */
  notary_model?: "standard" | "hands_off" | "aggressive";
}

export interface AcquisitionCosts {
  price_eur: number;
  price_from: "estimate" | "agreed" | "asking";
  acquisition_costs: {
    base_pct: number;
    rights_de_mutation_pct: number;
    droits_de_mutation: number;
    emoluments_notaire: number;
    publication: number;
    total_fees: number;
  };
  taxe_foncière_annuale: number;
  loyer: {
    eur_m2_month: number;
    eur_month: number;
    eur_year: number;
    status: "estimate" | "agreed" | "asking";
  };
  returns: {
    gross_yield_pct: number;
    net_yield_pct: number;
    net_after_fees_pct: number;
  };
}

function round0(v: number): number {
  return round(v, 0) ?? 0;
}

function round1(v: number): number {
  return round(v, 1) ?? 0;
}

/** The rent indicator fields this simulator reads from `rentEstimate`'s output. */
interface RentIndicatorView {
  rent_eur_m2_month?: number;
  estimated_monthly_rent_eur?: number;
}

export async function acquisitionCosts(args: AcquisitionCostsOptions): Promise<AcquisitionCosts> {
  if (args.surface_m2 < 8 || args.surface_m2 > 1000) {
    throw new Error("surface_m2 must be between 8 and 1 000 m².");
  }
  if (args.type_local !== "Appartement" && args.type_local !== "Maison") {
    throw new Error("type_local must be 'Appartement' or 'Maison'.");
  }
  if (!args.address) {
    throw new Error("address is required.");
  }
  const priceFrom = args.price_from ?? "estimate";
  if (!["estimate", "agreed", "asking"].includes(priceFrom)) {
    throw new Error("price_from must be one of: estimate, agreed, asking.");
  }
  const notaryModel = args.notary_model ?? "standard";
  if (!["standard", "hands_off", "aggressive"].includes(notaryModel)) {
    throw new Error("notary_model must be one of: standard, hands_off, aggressive.");
  }

  // ------------------------------------------------------------------ price
  let priceEur: number;
  if (args.price_eur !== undefined) {
    priceEur = args.price_eur;
  } else {
    const estimate = await estimateProperty({
      address: args.address,
      type_local: args.type_local,
      surface_m2: args.surface_m2,
    });
    priceEur = estimate.estimate.value_eur.estimate;
  }
  if (!Number.isFinite(priceEur) || priceEur <= 0) {
    throw new Error("Could not determine a usable purchase price.");
  }

  // ------------------------------------------------------ taxe foncière
  // The REI average is a bonus, never a requirement: an OFGL outage must not
  // kill a simulation whose yield is already computable from the rent.
  let taxeFonciereAnnuelle = 0;
  try {
    const taxEst = await propertyTaxEstimate({ location: args.address });
    taxeFonciereAnnuelle = taxEst?.typical_annual_charge_eur ?? 0;
  } catch {
    taxeFonciereAnnuelle = 0;
  }

  // ------------------------------------------------------ location
  const rent = await rentEstimate({ location: args.address, surface_m2: args.surface_m2 });
  const indicator =
    (rent.indicators.apartment as RentIndicatorView | null) ??
    (rent.indicators.house as RentIndicatorView | null);
  const rentM2 = indicator?.rent_eur_m2_month;
  if (rentM2 === undefined || rentM2 === null || !Number.isFinite(rentM2)) {
    throw new Error(
      "Could not find a rent indicator for " +
        args.address +
        " — add an address with a recognised INSEE code, or a commune-level address.",
    );
  }
  const loyerMensuel = indicator?.estimated_monthly_rent_eur ?? rentM2 * args.surface_m2;
  const loyerAnnuel = loyerMensuel * 12;

  const grossYield = (loyerAnnuel / priceEur) * 100;

  // ------------------------------------------------------ feats
  const droitsMutation = MUTATION_PCT / 100 * priceEur;

  const notaire =
    notaryModel === "aggressive"
      ? NOTARY_ACTE_MIN
      : notaryModel === "hands_off"
        ? NOTARY_ACTE_MIN + 250
        : NOTARY_ACTE_MIN + NOTARY_HOURS * NOTARY_RATE;
  const publication = 200;

  const acquisition = {
    base_pct: MUTATION_BASE_PCT,
    rights_de_mutation_pct: MUTATION_PCT,
    droits_de_mutation: round0(droitsMutation),
    emoluments_notaire: round0(notaire),
    publication: publication,
    total_fees: round0(round0(droitsMutation) + round0(notaire) + round0(publication)),
  };

  const totalFees = acquisition.total_fees;
  const netYield = (loyerAnnuel - taxeFonciereAnnuelle - totalFees) / priceEur * 100;

  const result: AcquisitionCosts = {
    price_eur: round0(priceEur),
    price_from: priceFrom,
    acquisition_costs: acquisition,
    taxe_foncière_annuale: taxeFonciereAnnuelle,
    loyer: {
      eur_m2_month: round1(rentM2),
      eur_month: round0(loyerMensuel),
      eur_year: round0(loyerAnnuel),
      status: priceFrom,
    },
    returns: {
      gross_yield_pct: round1(grossYield),
      net_yield_pct: round1(netYield),
      net_after_fees_pct: round1(netYield - (totalFees / priceEur) * 100),
    },
  };

  // The engine refuses any non-finite figure; assert early so callers never
  // see a malformed payload downstream.
  assertFinite(result.price_eur);
  assertFinite(result.acquisition_costs.total_fees);
  assertFinite(result.taxe_foncière_annuale);
  assertFinite(result.returns.gross_yield_pct);
  assertFinite(result.returns.net_yield_pct);

  return result;
}

function assertFinite(v: number): void {
  if (!Number.isFinite(v)) throw new Error("Non-finite figure produced by the acquisition engine.");
}

