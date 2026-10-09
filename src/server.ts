/**
 * Tool registry: builds the MCP server without attaching a transport.
 *
 * `index.ts` connects it to stdio; tests connect it to an in-memory transport.
 * Keeping those apart is what makes the tool contracts testable at all — the
 * entry point waits on a real process stream, which a unit test cannot do.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  geocodeAddress,
  propertySales,
  pricePerM2,
  estimateProperty,
  backtestEstimator,
  rentEstimate,
  propertyTaxEstimate,
  propertyReport,
  cadastralParcel,
  urbanismZoning,
  irisLookup,
  nearbyAmenities,
  rentControl,
  dpeLookup,
  naturalRisks,
  communeInfo,
  whatIsHere,
  compareProperties,
  acquisitionCosts,
  searchByBudget,
  riskSummary,
} from "./handlers.js";
import { OUTPUT_SCHEMAS } from "./output-schemas.js";
import { VERSION } from "./version.js";

type Handler<A> = (args: A) => Promise<unknown>;

/**
 * Every tool answers twice, on purpose: `structuredContent` is the typed
 * contract a modern client can render, and the text block carries the same JSON
 * for clients that predate output schemas (2025-06-18). Neither is redundant
 * until every client has moved on.
 */
function wrap<A>(handler: Handler<A>) {
  return async (args: A) => {
    try {
      const result = await handler(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Deliberately no structuredContent on failure: the schema describes a
      // successful answer, and the SDK skips output validation when isError is
      // set, so a tool error stays a tool error instead of a protocol error.
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

// Shared schema fragments: one definition per reused input, so every tool
// describes the same parameter the same way.
const yearsSchema = z
  .array(z.number().int())
  .optional()
  .describe("DVF years to include (2021-2025). Defaults to all.");
const typeLocalSchema = () =>
  z.enum(["Appartement", "Maison"]).optional().describe("Filter by dwelling type");
const radiusSchema = (def: number, min = 20) =>
  z
    .number()
    .min(min)
    .max(5000)
    .optional()
    .describe(`Search radius in meters around the address (default ${def}; ignored for city-wide queries)`);
const pointInputSchema = () => ({
  address: z.string().optional().describe("Address in France (alternative to lat/lon)"),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-immo-olv",
    version: VERSION,
  });

  server.registerTool(
    "geocode_address",
    {
      title: "Geocode a French address",
      description:
        "Resolve a French address, street, or city to normalized candidates with coordinates, INSEE city code and BAN id (Base Adresse Nationale). Use this first if an address is ambiguous.",
      inputSchema: {
        query: z.string().describe("Free-form address, e.g. '10 rue de la Paix Paris'"),
        limit: z.number().int().min(1).max(20).optional().describe("Max candidates (default 5)"),
      },
      outputSchema: OUTPUT_SCHEMAS.geocode_address,
    },
    wrap(geocodeAddress),
  );

  server.registerTool(
    "property_sales",
    {
      title: "Real property sales around an address (DVF)",
      description:
        "List actual notarized property sales (price, date, surface, rooms) recorded by the French tax administration (DVF) around an address, or for a whole commune if only a city is given. Data 2021-2025, no API key.",
      inputSchema: {
        address: z.string().describe("Address, street or city in France"),
        radius_m: radiusSchema(300),
        years: yearsSchema,
        type_local: typeLocalSchema(),
        min_surface_m2: z.number().optional(),
        max_surface_m2: z.number().optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Max sales returned (default 30)"),
      },
      outputSchema: OUTPUT_SCHEMAS.property_sales,
    },
    wrap(propertySales),
  );

  server.registerTool(
    "price_per_m2",
    {
      title: "Price per m² statistics (DVF)",
      description:
        "Compute price-per-m² statistics (median, mean, quartiles, per-year evolution) from actual notarized sales around a French address or across a commune. Data 2021-2025.",
      inputSchema: {
        address: z.string().describe("Address, street or city in France"),
        type_local: typeLocalSchema(),
        years: yearsSchema,
        radius_m: radiusSchema(500, 50),
      },
      outputSchema: OUTPUT_SCHEMAS.price_per_m2,
    },
    wrap(pricePerM2),
  );

  server.registerTool(
    "estimate_property",
    {
      title: "Estimate a property's value (comparables)",
      description:
        "Transparent comparables-based valuation of a flat or house at a precise French address: weighted median of nearby single-dwelling notarized sales, adjusted to current market level, with every comp and weight returned for audit. Also returns the official rent indicator and gross rental yield.",
      inputSchema: {
        address: z.string().describe("Precise address (street + number preferred)"),
        type_local: z.enum(["Appartement", "Maison"]),
        surface_m2: z.number().min(8).max(1000).describe("Living surface in m²"),
        rooms: z.number().int().min(1).max(20).optional().describe("Main rooms (pièces principales) — refines the rent indicator"),
      },
      outputSchema: OUTPUT_SCHEMAS.estimate_property,
    },
    wrap(estimateProperty),
  );

  server.registerTool(
    "rent_estimate",
    {
      title: "Rent indicators (Carte des loyers)",
      description:
        "Official modelled asking rents (€/m²/month, charges included) for any French commune: apartments overall, 1-2 rooms, 3+ rooms, and houses. Source: Carte des loyers, Ministère du Logement / ANIL.",
      inputSchema: {
        location: z.string().describe("Address, commune name or INSEE code"),
        surface_m2: z.number().optional().describe("If given, also returns the estimated monthly rent"),
      },
      outputSchema: OUTPUT_SCHEMAS.rent_estimate,
    },
    wrap(rentEstimate),
  );

  server.registerTool(
    "property_tax_estimate",
    {
      title: "Average property tax by commune (REI)",
      description:
        "Returns the annual average charge per taxable REI article for taxe foncière on built properties, including published communal, intercommunal, syndicate, GEMAPI and TEOM components. It is an aggregate proxy, not an individual property's tax bill. Source: DGFiP REI via OFGL.",
      inputSchema: {
        location: z.string().describe("Address, commune name or INSEE code"),
        year: z.number().int().min(2024).max(2100).optional().describe("REI tax year; defaults to the latest available year"),
      },
      outputSchema: OUTPUT_SCHEMAS.property_tax_estimate,
    },
    wrap(propertyTaxEstimate),
  );

  server.registerTool(
    "property_report",
    {
      title: "Full property due-diligence report",
      description:
        "One call, full dossier for a French address: price-per-m² market stats, recent notarized sales, energy diagnostics (DPE), natural & technological risks, commune profile, official rent indicators and an aggregate taxe foncière proxy — plus a comparables-based valuation, gross yield and yield after average property tax when type_local and surface_m2 are provided. Ideal first call when a user asks about a specific property. Pass `addresses` (2 to 5) instead of `address` to dossier several neighbourhoods in one call; each report is isolated, so one bad address returns its own error without sinking the batch.",
      inputSchema: {
        address: z.string().optional().describe("Address in France (mutually exclusive with `addresses`)"),
        addresses: z
          .array(z.string())
          .min(2, "A batch needs at least 2 addresses in `addresses` (pass `address` for a single dossier).")
          .max(5, "A batch takes at most 5 addresses in `addresses`.")
          .optional()
          .describe("2 to 5 addresses to dossier in one call, for comparing neighbourhoods (mutually exclusive with `address`)"),
        type_local: typeLocalSchema(),
        surface_m2: z.number().min(8).max(1000).optional(),
        rooms: z.number().int().min(1).max(20).optional(),
        format: z
          .enum(["json", "markdown"])
          .optional()
          .describe("Answer shape: 'json' (default, structured dossier) or 'markdown' (same dossier rendered as shareable Markdown)"),
      },
      outputSchema: OUTPUT_SCHEMAS.property_report,
    },
    wrap(propertyReport),
  );

  server.registerTool(
    "dpe_lookup",
    {
      title: "Energy performance diagnostics (DPE)",
      description:
        "Find official energy performance certificates (DPE: energy label A-G, GES label, surface, construction year) filed for a French address, with the legal rental status at each label (décret n° 2024-501) and an estimated annual energy cost. Source: ADEME open data.",
      inputSchema: {
        address: z.string().describe("Address in France"),
        limit: z.number().int().min(1).max(50).optional().describe("Max diagnostics returned (default 10)"),
        dataset: z
          .enum(["all", "existant", "neuf"])
          .optional()
          .describe("DPE register: existing dwellings (dpe03existant), new dwellings (dpe02neuf), or both (default all)"),
        energy_price_eur_kwh: z
          .number()
          .min(0.01)
          .max(2)
          .optional()
          .describe("Tariff assumption for the energy-cost estimate in €/kWh (default 0.2562)"),
      },
      outputSchema: OUTPUT_SCHEMAS.dpe_lookup,
    },
    wrap(dpeLookup),
  );

  server.registerTool(
    "natural_risks",
    {
      title: "Natural & technological risks (Géorisques)",
      description:
        "Official risk report for a French address or point: flood, clay shrink-swell, radon, earthquake, industrial sites... Source: Géorisques (Ministère de la Transition écologique).",
      inputSchema: {
        ...pointInputSchema(),
      },
      outputSchema: OUTPUT_SCHEMAS.natural_risks,
    },
    wrap(naturalRisks),
  );

  server.registerTool(
    "commune_info",
    {
      title: "Commune information",
      description:
        "Population, postcodes, département, région, surface and center coordinates of a French commune, by name or INSEE code.",
      inputSchema: {
        query: z.string().describe("Commune name or 5-char INSEE code (e.g. 'Lyon' or '69123')"),
      },
      outputSchema: OUTPUT_SCHEMAS.commune_info,
    },
    wrap(communeInfo),
  );

  server.registerTool(
    "reverse_geocode",
    {
      title: "Reverse geocode",
      description: "Find the nearest French address for GPS coordinates.",
      inputSchema: {
        lat: z.number(),
        lon: z.number(),
      },
      outputSchema: OUTPUT_SCHEMAS.reverse_geocode,
    },
    wrap(whatIsHere),
  );

  server.registerTool(
    "backtest_estimator",
    {
      title: "Walk-forward backtest of the valuation model",
      description:
        "Replay the comparable-sales estimator on the commune's own notarized sales: every historical sale is valued using only the sales recorded before it (no look-ahead, own deed excluded), then compared with the price actually paid. Returns MAPE, median and 90th-percentile absolute error, signed bias, P25–P75 range coverage and the same metrics by surface band and by year. Use it to say how reliable estimate_property is in this specific market.",
      inputSchema: {
        address: z.string().describe("Precise address (street or house number) in France"),
        type_local: z.enum(["Appartement", "Maison"]).describe("Property type to backtest"),
        from_year: z
          .number()
          .int()
          .min(2021)
          .optional()
          .describe("First sale year to evaluate (default: every year available)"),
        to_year: z.number().int().optional().describe("Last sale year to evaluate"),
        max_points: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max sales evaluated, most recent first (default 250)"),
      },
      outputSchema: OUTPUT_SCHEMAS.backtest_estimator,
    },
    wrap(backtestEstimator),
  );

  server.registerTool(
    "cadastral_parcel",
    {
      title: "Cadastral parcel at an address",
      description:
        "Official cadastral parcel(s) containing an address: unique cadastral id (idu) quoted on deeds, section, number and the official contenance in m². The contenance is the taxed area of the whole parcel, land included — not the dwelling's habitable surface — and the cadastre never records ownership. Source: IGN / DGFiP via API Carto.",
      inputSchema: {
        ...pointInputSchema(),
      },
      outputSchema: OUTPUT_SCHEMAS.cadastral_parcel,
    },
    wrap(cadastralParcel),
  );

  server.registerTool(
    "urbanism_zoning",
    {
      title: "Urbanism rules at an address (PLU)",
      description:
        "Urbanism zoning and prescriptions applicable to an address, from the Géoportail de l'urbanisme: zoning area label and type (U urban, AU to be urbanised, A agricultural, N natural), the regulation document reference, and the surface / linear / point prescriptions (emplacements réservés, protected areas, alignments…). It states which rules apply, never whether a project is permitted. Source: GPU, DGALN / IGN.",
      inputSchema: {
        ...pointInputSchema(),
      },
      outputSchema: OUTPUT_SCHEMAS.urbanism_zoning,
    },
    wrap(urbanismZoning),
  );

  server.registerTool(
    "iris_lookup",
    {
      title: "IRIS neighbourhood of an address",
      description:
        "Identify the IRIS — INSEE's infra-communal statistical unit, about 2 000 inhabitants — containing an address: 9-character IRIS code, name, type and commune. Join that code to INSEE's IRIS tables for population and Filosofi income. Boundaries from IGN ADMINEXPRESS; this layer carries identity only, no socio-demographic figures.",
      inputSchema: {
        address: z.string().describe("Address in France"),
      },
      outputSchema: OUTPUT_SCHEMAS.iris_lookup,
    },
    wrap(irisLookup),
  );

  server.registerTool(
    "nearby_amenities",
    {
      title: "What is around an address (POIs)",
      description:
        "Nearby points of interest around a French address or point, from OpenStreetMap: public transport (train, metro, tram, bus stop), schools and higher education, everyday shops, health (pharmacy, doctor, hospital) and green/sport space — each with how many are within the radius and the closest ones, in metres as the crow flies. Answers the neighbourhood question no official French dataset covers directly. When Overpass is unreachable, every count is UNKNOWN (null) rather than zero. Source: OpenStreetMap contributors (ODbL), via the Overpass API.",
      inputSchema: {
        ...pointInputSchema(),
        radius_m: z
          .number()
          .min(100)
          .max(5000)
          .optional()
          .describe("Search radius in meters around the point (default 1000)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("How many closest POIs to list per category (default 3)"),
      },
      outputSchema: OUTPUT_SCHEMAS.nearby_amenities,
    },
    wrap(nearbyAmenities),
  );

  server.registerTool(
    "rent_control",
    {
      title: "Rent-control reference rents",
      description:
        "Loyer de référence, loyer de référence majoré (the legal ceiling) and minoré, in €/m²/month, for a rent-controlled area — by number of rooms, construction period and furnished status. Covers only the areas whose authority publishes an open grid (Paris, Métropole de Lyon); the response states explicitly when an address is not covered instead of guessing. Sources: Ville de Paris, Métropole de Lyon.",
      inputSchema: {
        address: z.string().describe("Address in France"),
        rooms: z.number().int().min(1).max(10).optional().describe("Number of rooms (pièces)"),
        furnished: z.boolean().optional().describe("Furnished (true) or unfurnished (false)"),
        period: z.string().optional().describe("Construction period label, e.g. '1946-1970'"),
      },
      outputSchema: OUTPUT_SCHEMAS.rent_control,
    },
    wrap(rentControl),
  );

  server.registerTool(
    "compare_properties",
    {
      title: "Compare 2–5 addresses side by side",
      description:
        "Side-by-side comparison of 2 to 5 French addresses in one call: current market level (€/m²), comparables valuation with confidence, asking rents, DPE with legal rental status (décret n° 2024-501) and estimated energy cost, plus row-index rankings (cheapest market, best yield). Each section degrades independently, like property_report. Source: DVF, Carte des loyers, ADEME — official open data.",
      inputSchema: {
        targets: z
          .array(
            z.object({
              address: z.string().describe("Address in France"),
              type_local: z
                .enum(["Appartement", "Maison"])
                .optional()
                .describe("Enables the valuation row; filter by dwelling type"),
              surface_m2: z
                .number()
                .min(8)
                .max(1000)
                .optional()
                .describe("Enables the valuation and gross-yield rows"),
              rooms: z.number().int().min(1).max(20).optional().describe("Main rooms (pièces)"),
            }),
          )
          .min(2, "A comparison needs at least 2 targets.")
          .max(5, "A comparison takes at most 5 targets.")
          .describe("2 to 5 addresses to compare, in your order"),
        radius_m: radiusSchema(500),
      },
      outputSchema: OUTPUT_SCHEMAS.compare_properties,
    },
    wrap(compareProperties),
  );

  server.registerTool(
    "acquisition_costs",
    {
      title: "Acquisition costs and yield simulation",
      description:
        "Simulate the costs of buying a French dwelling and its rental yield: droits de mutation (official 2026 scale, about 6.42 % for communes over 5 000 inhabitants), notary fees and publication, commune-average taxe foncière (REI), modelled asking rent (Carte des loyers), and gross / net yields. The price defaults to a comparables-based estimate (estimate_property) but can be replaced by an agreed or asking price. All figures are indicative — the taxe foncière is a commune average, never an individual tax notice, and rents are modelled asking rents, not regulated reference rents. Source: DVF, Carte des loyers, REI.",
      inputSchema: {
        address: z.string().describe("Address in France"),
        type_local: z.enum(["Appartement", "Maison"]).describe("Dwelling type"),
        surface_m2: z.number().min(8).max(1000).describe("Living surface in m²"),
        rooms: z.number().int().min(1).max(20).optional().describe("Main rooms (pièces)"),
        price_eur: z
          .number()
          .min(1)
          .optional()
          .describe("Known price in € (negotiated or asking). Absent: use the comparables-based estimate."),
        price_from: z
          .enum(["estimate", "agreed", "asking"])
          .optional()
          .describe("What price_eur means when provided; 'estimate' (default) lets the tool value the dwelling itself"),
        notary_model: z
          .enum(["standard", "hands_off", "aggressive"])
          .optional()
          .describe("Notary fee assumption: standard (typical card), hands_off (about +250 €), aggressive (bare minimum, 750 €)"),
      },
      outputSchema: OUTPUT_SCHEMAS.acquisition_costs,
    },
    wrap(acquisitionCosts),
  );

  server.registerTool(
    "search_by_budget",
    {
      title: "Find what a budget can buy in a zone",
      description:
        "The inverse of the estimator: 'with 300 k€, where can I buy?' For each commune of a département it computes the median €/m² from actual notarized sales (DVF, last 4 published years), divides the budget by it to get the surface the budget buys, and layers the modelled asking rent for the gross yield. Returns the qualifying communes ranked by surface, yield and price, plus the communes skipped for lack of data. The budget is the purchase price only — acquisition fees come on top (see acquisition_costs). Source: DVF, Carte des loyers, geo.api.gouv.fr.",
      inputSchema: {
        budget_eur: z.number().min(1000).describe("Purchase budget in €, fees excluded"),
        type_local: z.enum(["Appartement", "Maison"]).optional().describe("Dwelling type; absent: all single-dwelling sales"),
        zone: z
          .string()
          .describe("Commune name, INSEE code, address, or département code (e.g. '69', '13')"),
        min_surface_m2: z.number().min(1).max(500).optional().describe("Minimum surface the budget must buy (default 30)"),
        max_communes: z.number().int().min(1).max(40).optional().describe("Communes to scan, most populous first (default 15, max 40)"),
      },
      outputSchema: OUTPUT_SCHEMAS.search_by_budget,
    },
    wrap(searchByBudget),
  );

  server.registerTool(
    "risk_summary",
    {
      title: "Risk summary: one line per risk",
      description:
        "Consumer-grade risk digest for a French address or point: one plain-language sentence each for flood, clay shrink-swell, radon, industrial sites (ICPE) and the DPE rental-ban schedule, plus a one-line headline and any other present risk named. Reuses Géorisques and ADEME. When Géorisques is unreachable every risk line reads UNKNOWN — never a clean bill of health. Source: Géorisques, ADEME.",
      inputSchema: {
        ...pointInputSchema(),
      },
      outputSchema: OUTPUT_SCHEMAS.risk_summary,
    },
    wrap(riskSummary),
  );

  return server;
}

/** Tool names in registration order — the single source of truth for tests. */
export const TOOL_NAMES = Object.keys(OUTPUT_SCHEMAS) as (keyof typeof OUTPUT_SCHEMAS)[];
