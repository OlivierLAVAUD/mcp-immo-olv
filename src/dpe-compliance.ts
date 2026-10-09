/**
 * Rental legality and running energy cost, derived from the DPE label.
 *
 * Legal basis: décret n° 2024-501 du 26 juin 2024 (extending the ELAN regime to
 * furnished main-residence leases). A main-residence lease — meublé or not —
 * cannot be signed for a dwelling above a class that Parliament has dated:
 * the ban bites on the date, not on publication of this code, so this module
 * always compares against an injected `today` and reports the date it used.
 *
 * "Passoire thermique" is the official F/G wording (arrêté du 31 août 2021);
 * H appears only on pre-2021 diagnostics and is treated as G.
 */

/** Label → first day on which a new lease is unlawful (ISO date). A–D: no ban. */
const RENTAL_BANS: Record<string, string> = {
  G: "2025-01-01",
  H: "2025-01-01",
  F: "2028-01-01",
  E: "2034-01-01",
};

/** Official passoires thermiques: classes F and G (H = old-scale G). */
const PASSOIRES = new Set(["F", "G", "H"]);

export type RentalStatus = "louable" | "bientot_interdit" | "interdit" | "inconnu";

export interface RentalCompliance {
  energy_label: string | null;
  rental_status: RentalStatus;
  /** First day a new lease becomes unlawful; null when no ban is dated. */
  ban_date: string | null;
  is_passoire_thermique: boolean;
}

/**
 * Translate a DPE energy label into its rental status at `today`.
 * `inconnu` means the label is absent or unreadable — never "no restriction".
 */
export function rentalCompliance(label: string | null | undefined, today = new Date()): RentalCompliance {
  const key = (label ?? "").trim().toUpperCase();
  const known = key in RENTAL_BANS || ["A", "B", "C", "D"].includes(key);
  if (!known) {
    return { energy_label: label ?? null, rental_status: "inconnu", ban_date: null, is_passoire_thermique: false };
  }
  const clean = key;
  const banDate = RENTAL_BANS[clean] ?? null;
  const status: RentalStatus =
    banDate === null
      ? "louable"
      : banDate <= today.toISOString().slice(0, 10)
        ? "interdit"
        : "bientot_interdit";
  return {
    energy_label: clean,
    rental_status: status,
    ban_date: banDate,
    is_passoire_thermique: PASSOIRES.has(clean),
  };
}

export interface EnergyCostEstimate {
  conso_kwh_year: number;
  energy_price_eur_kwh: number;
  annual_cost_eur: number;
}

/** Default tariff assumption: TRV EDF base power, early 2025 order of magnitude. */
export const DEFAULT_ENERGY_PRICE_EUR_KWH = 0.2562;

/**
 * Annual primary-energy cost from the DPE consumption figure. Returns null when
 * the diagnostic carries no consumption or no surface — never a zero estimate.
 */
export function annualEnergyCost(
  conso_kwh_m2_year: number | null | undefined,
  surface_m2: number | null | undefined,
  energyPriceEurKwh: number = DEFAULT_ENERGY_PRICE_EUR_KWH,
): EnergyCostEstimate | null {
  if (
    conso_kwh_m2_year === null ||
    conso_kwh_m2_year === undefined ||
    !Number.isFinite(conso_kwh_m2_year) ||
    conso_kwh_m2_year < 0 ||
    surface_m2 === null ||
    surface_m2 === undefined ||
    !Number.isFinite(surface_m2) ||
    surface_m2 <= 0 ||
    !Number.isFinite(energyPriceEurKwh) ||
    energyPriceEurKwh <= 0
  ) {
    return null;
  }
  const consoKwhYear = Math.round(conso_kwh_m2_year * surface_m2);
  return {
    conso_kwh_year: consoKwhYear,
    energy_price_eur_kwh: energyPriceEurKwh,
    annual_cost_eur: Math.round(consoKwhYear * energyPriceEurKwh),
  };
}