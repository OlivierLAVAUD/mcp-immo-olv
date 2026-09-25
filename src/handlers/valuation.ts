import { round } from "../util/stats.js";
import { rentIndicator, RentKind, RENT_KINDS, RENT_YEAR } from "../apis/loyers.js";
import { propertyTaxByCommune } from "../apis/taxes.js";
import { estimateValue as runEstimate } from "../estimator.js";
import { DVF_SOURCE, RENT_SOURCE, loadMutations, locate, validYears } from "./shared.js";

export async function estimateProperty(args: {
  address: string;
  type_local: "Appartement" | "Maison";
  surface_m2: number;
  rooms?: number;
}) {
  const located = await locate(args.address);
  const { geo } = located;
  if (geo.type !== "housenumber" && geo.type !== "street") {
    throw new Error(
      `"${args.address}" resolved to a ${geo.type}; a precise address (street or house number) is required for a valuation.`,
    );
  }

  const { mutations, communes } = await loadMutations(located, 2500, validYears());
  const estimate = runEstimate(
    { lat: geo.lat, lon: geo.lon, type: args.type_local, surfaceM2: args.surface_m2 },
    mutations,
  );
  if (!estimate) {
    throw new Error(
      "Fewer than 3 comparable sales found around this address — not enough data for an honest estimate. Try price_per_m2 at commune level instead.",
    );
  }

  // Rental angle: official asking-rent indicator + gross yield. Tax data is a
  // commune-level average, not the individual bill; it refines the yield only
  // when both sources are available and never blocks a valuation.
  let rental: unknown = null;
  const kind: RentKind =
    args.type_local === "Maison"
      ? "house"
      : args.rooms === undefined
        ? "apartment"
        : args.rooms <= 2
          ? "apartment_1_2_rooms"
          : "apartment_3plus_rooms";
  try {
    const [rent, propertyTax] = await Promise.all([
      rentIndicator(geo.citycode!, kind),
      // Tax is supplementary: an OFGL outage must not erase the official rent
      // indicator and gross yield that we already have.
      propertyTaxByCommune(geo.citycode!).catch(() => null),
    ]);
    if (rent) {
      const monthly = rent.rentM2 * args.surface_m2;
      const annualRent = monthly * 12;
      rental = {
        source: RENT_SOURCE,
        indicator: kind,
        scope: rent.scope,
        rent_eur_m2_month: round(rent.rentM2, 2),
        range_eur_m2_month: [round(rent.lowM2, 2), round(rent.highM2, 2)],
        estimated_monthly_rent_eur: round(monthly, 0),
        gross_yield_pct: round((annualRent * 100) / estimate.value_eur.estimate, 2),
        ...(propertyTax
          ? {
              property_tax_average: propertyTax,
              net_yield_after_average_property_tax_pct: round(
                ((annualRent - propertyTax.typical_annual_charge_eur) * 100) /
                  estimate.value_eur.estimate,
                2,
              ),
            }
          : {}),
      };
    }
  } catch {
    // Rent/tax data are bonuses; never fail the valuation for them.
  }

  return {
    source: DVF_SOURCE,
    query: {
      resolved_address: geo.label,
      type_local: args.type_local,
      surface_m2: args.surface_m2,
      communes_searched: communes,
    },
    estimate,
    rental,
    caveats: [
      "Comparables-based estimate from public notarized sales; condition, floor, view, renovation state are unknown to the model.",
      "Every comp and weight is listed in top_comps — audit them before quoting the figure.",
      "This is public-data analysis, not a professional appraisal (avis de valeur).",
    ],
  };
}

export async function rentEstimate(args: { location: string; surface_m2?: number }) {
  const q = args.location.trim();
  let citycode: string;
  let label: string;
  if (/^\d[0-9AB]\d{3}$/i.test(q)) {
    citycode = q.toUpperCase();
    label = `INSEE ${citycode}`;
  } else {
    const { geo } = await locate(q);
    citycode = geo.citycode!;
    label = geo.label;
  }

  const indicators: Record<string, unknown> = {};
  await Promise.all(
    RENT_KINDS.map(async (kind) => {
      const hit = await rentIndicator(citycode, kind);
      indicators[kind] = hit
        ? {
            rent_eur_m2_month: round(hit.rentM2, 2),
            range_eur_m2_month: [round(hit.lowM2, 2), round(hit.highM2, 2)],
            scope: hit.scope,
            listings_observed: hit.observations,
            ...(args.surface_m2
              ? { estimated_monthly_rent_eur: round(hit.rentM2 * args.surface_m2, 0) }
              : {}),
          }
        : null;
    }),
  );

  return {
    source: RENT_SOURCE,
    location: label,
    insee_code: citycode,
    year: RENT_YEAR,
    indicators,
    note: "Modelled asking rents (charges included) from SeLoger/Leboncoin listings — not regulated reference rents.",
  };
}

/**
 * Commune-level taxe foncière proxy from the official REI fiscal dataset.
 * It is deliberately a separate tool because an average tax article is useful
 * context, but never a substitute for the property owner's actual tax notice.
 */
export async function propertyTaxEstimate(args: { location: string; year?: number }) {
  const { geo } = await locate(args.location);
  const estimate = await propertyTaxByCommune(geo.citycode!, args.year);
  if (!estimate) {
    throw new Error(
      `No usable REI taxe foncière data for ${geo.citycode} ${geo.city ?? args.location}${args.year ? ` in ${args.year}` : ""}.`,
    );
  }
  return {
    query: { resolved_location: geo.label, insee_code: geo.citycode },
    ...estimate,
  };
}
