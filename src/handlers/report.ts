import { locate, section } from "./shared.js";
import { renderReportMarkdown } from "../markdown.js";
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

/** The profile a single dossier is built from — one address, shared options. */
interface DossierQuery {
  address: string;
  type_local?: "Appartement" | "Maison";
  surface_m2?: number;
  rooms?: number;
}

export interface PropertyReportArgs {
  /** A single address (mutually exclusive with `addresses`). */
  address?: string;
  /** 2 to 5 addresses to dossier in one call, for comparing neighbourhoods. */
  addresses?: string[];
  type_local?: "Appartement" | "Maison";
  surface_m2?: number;
  rooms?: number;
  /** "json" (default) returns the structured dossier; "markdown" returns it rendered. */
  format?: "json" | "markdown";
}

/** Upper bound of the batch form — beyond five, the fan-out is not worth it. */
export const MAX_REPORT_ADDRESSES = 5;

/**
 * Build one full dossier. Sections fail independently: a Géorisques outage must
 * not take the market analysis down with it. Shared by the single-address and
 * the batch form so the two can never drift apart.
 */
async function buildDossier(args: DossierQuery) {
  const { geo } = await locate(args.address);

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

/** How one address of a batch is returned: its dossier, or why it failed. */
function renderBatchEntry(
  address: string,
  result: Awaited<ReturnType<typeof buildDossier>> | { error: string },
  format: "json" | "markdown",
) {
  if ("error" in result) return { input_address: address, error: result.error };
  return {
    input_address: address,
    ...(format === "markdown"
      ? { format: "markdown" as const, content: renderReportMarkdown(result) }
      : result),
  };
}

/**
 * One call → full due-diligence dossier, for a single address or a 2–5 address
 * batch. In the batch form every address is isolated: one that cannot be
 * resolved returns its own `error` and leaves the others intact, exactly as a
 * section that fails never takes its neighbours down inside one dossier.
 */
export async function propertyReport(args: PropertyReportArgs) {
  const format = args.format ?? "json";
  const profile = {
    type_local: args.type_local,
    surface_m2: args.surface_m2,
    rooms: args.rooms,
  };

  if (args.addresses !== undefined) {
    if (args.address !== undefined) {
      throw new Error("Provide either `address` (one dossier) or `addresses` (2–5), not both.");
    }
    if (args.addresses.length < 2 || args.addresses.length > MAX_REPORT_ADDRESSES) {
      throw new Error(
        `property_report batch needs 2 to ${MAX_REPORT_ADDRESSES} addresses in \`addresses\` (got ${args.addresses.length}).`,
      );
    }

    const reports = await Promise.all(
      args.addresses.map(async (address) => {
        const result = await section(() => buildDossier({ address, ...profile }));
        return renderBatchEntry(address, result, format);
      }),
    );

    return {
      format,
      query: {
        addresses_count: args.addresses.length,
        type_local: args.type_local ?? null,
        surface_m2: args.surface_m2 ?? null,
        rooms: args.rooms ?? null,
      },
      reports,
      note: "One dossier per requested address, in order, built with the same profile. An entry carrying `error` could not be resolved — the others are unaffected. Each dossier still isolates its own sections, exactly like the single-address form.",
      caveats: [
        "A batch fans out over every section of every address: it saves client round-trips, not upstream work.",
        "This is public-data analysis, not a professional appraisal (avis de valeur).",
      ],
    };
  }

  if (args.address === undefined) {
    throw new Error("property_report needs an `address`, or 2 to 5 addresses in `addresses`.");
  }

  const dossier = await buildDossier({ address: args.address, ...profile });

  if (format === "markdown") {
    return {
      format: "markdown" as const,
      content: renderReportMarkdown(dossier),
    };
  }

  return dossier;
}
