import { locate } from "./shared.js";
import {
  pricePerM2,
  propertySales,
} from "./market.js";
import {
  estimateProperty,
  rentEstimate,
  propertyTaxEstimate,
} from "./valuation.js";
import {
  dpeLookup,
  naturalRisks,
  communeInfo,
  cadastralParcel,
  urbanismZoning,
  irisLookup,
  rentControl,
} from "./context.js";

/**
 * One call → full due-diligence dossier. Sections fail independently: a
 * Géorisques outage must not take the market analysis down with it.
 */
export async function propertyReport(args: {
  address: string;
  type_local?: "Appartement" | "Maison";
  surface_m2?: number;
  rooms?: number;
}) {
  const { geo } = await locate(args.address);

  const section = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const wantValuation = args.type_local !== undefined && args.surface_m2 !== undefined;
  const [
    market,
    sales,
    energy,
    risks,
    commune,
    rent,
    valuation,
    propertyTax,
    cadastre,
    urbanism,
    iris,
    rentControlSection,
  ] = await Promise.all([
    section(() => pricePerM2({ address: args.address, type_local: args.type_local, radius_m: 600 })),
    section(() => propertySales({ address: args.address, type_local: args.type_local, radius_m: 400, limit: 8 })),
    section(() => dpeLookup({ address: args.address, limit: 5 })),
    section(() => naturalRisks({ address: args.address })),
    section(() => communeInfo({ query: geo.citycode! })),
    section(() => rentEstimate({ location: args.address, surface_m2: args.surface_m2 })),
    wantValuation
      ? section(() =>
          estimateProperty({
            address: args.address,
            type_local: args.type_local!,
            surface_m2: args.surface_m2!,
            rooms: args.rooms,
          }),
        )
      : Promise.resolve(null),
    section(() => propertyTaxEstimate({ location: args.address })),
    // Enrichment sections are isolated exactly like the rest: an IGN or GPU
    // outage must degrade one block of the dossier, not the whole report.
    section(() => cadastralParcel({ address: args.address })),
    section(() => urbanismZoning({ address: args.address })),
    section(() => irisLookup({ address: args.address })),
    section(() => rentControl({ address: args.address, rooms: args.rooms })),
  ]);

  return {
    resolved_address: geo.label,
    market,
    recent_sales_nearby: sales,
    valuation,
    rent,
    rent_control: rentControlSection,
    property_tax: propertyTax,
    cadastre,
    urbanism,
    iris,
    energy_diagnostics: energy,
    risks,
    commune,
    generated_from:
      "DVF (DGFiP/Etalab), Carte des loyers (Min. Logement/ANIL), ADEME, Géorisques, BAN, INSEE — all official French open data, queried live.",
  };
}
