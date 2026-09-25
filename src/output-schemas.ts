/**
 * Output contracts for every tool: a Zod schema describing the object each
 * handler returns.
 *
 * Why this exists
 * ---------------
 * Until now every tool answered with a JSON *string* in a text content block,
 * so each client had to parse that string before it could render anything.
 * Declaring an output schema (MCP 2025-06-18) makes the same payload travel as
 * `structuredContent`, validated by the SDK before it reaches the client: a
 * client can now type a result, render a card from it, and trust that the shape
 * it was promised is the shape it got.
 *
 * Two rules keep this file honest and cheap:
 *
 *  1. **The schema mirrors the handler, not the wish.** Field names, nullability
 *     and optionality are copied from the TypeScript interfaces the handlers
 *     actually build (`Estimate`, `Mutation`, `BacktestReport`, `SimplifiedRisks`…).
 *     A field the source may omit is `.optional()`, a field the source may null
 *     is `.nullable()` — guessing either way turns a working tool into a
 *     validation error.
 *  2. **Descriptions are rationed.** An output schema ships in every `tools/list`
 *     response, i.e. it costs context in every client, on every session. Only
 *     fields whose meaning is not obvious from the name carry a description.
 *
 * The text block is still emitted alongside `structuredContent`: clients that
 * predate the spec keep working unchanged.
 *
 * Extra keys are not an error (Zod object schemas ignore unknown keys), so an
 * upstream API that adds a field tomorrow cannot break a tool today.
 */
import { z } from "zod";

/**
 * `z.object` plus passthrough.
 *
 * Zod strips unknown keys by default, which makes the published JSON Schema
 * say `additionalProperties: false`. The payloads here routinely carry upstream
 * fields we do not model — ADEME ships `_score`, IGN ships extra cadastral
 * columns — so the honest contract is an open object: unknown keys are
 * tolerated, and the schema says so instead of promising the opposite.
 */
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

/* ------------------------------------------------------------------- atoms */

const confidence = z.enum(["high", "medium", "low"]);
const rentKind = z.enum(["apartment", "apartment_1_2_rooms", "apartment_3plus_rooms", "house"]);

const point = obj({ lat: z.number(), lon: z.number() });

const geocodeResult = obj({
  label: z.string(),
  banId: z.string().nullable().describe("BAN interoperability id, citycode_streetcode_number"),
  housenumber: z.string().nullable(),
  street: z.string().nullable(),
  postcode: z.string().nullable(),
  city: z.string().nullable(),
  citycode: z.string().nullable().describe("INSEE code, arrondissement level in Paris/Lyon/Marseille"),
  type: z.string().describe("housenumber | street | locality | municipality"),
  lat: z.number(),
  lon: z.number(),
  score: z.number(),
});

const geocodeOutput = obj({
  source: z.string(),
  results: z.array(geocodeResult),
});

/* ------------------------------------------------------------------ market */

const sale = obj({
  date: z.string(),
  nature: z.string(),
  price_eur: z.number().nullable(),
  addresses: z.array(z.string()),
  dwellings: z.array(
    obj({
      type: z.string(),
      surface: z.number().nullable(),
      rooms: z.number().nullable(),
    }),
  ),
  other_locals: z.array(z.string()).optional(),
  land_surface_m2: z.number().nullable(),
  price_per_m2: z
    .number()
    .nullable()
    .describe("Set only when the deed covers exactly one dwelling"),
});

const propertySalesOutput = obj({
  source: z.string(),
  query: obj({
    resolved_address: z.string(),
    scope: z.string(),
    years: z.array(z.number()),
  }),
  total_matching_sales: z.number(),
  sales: z.array(sale),
  note: z.string(),
});

const priceStats = obj({
  sales: z.number(),
  median_eur_m2: z.number().nullable(),
  mean_eur_m2: z.number().nullable(),
  p25_eur_m2: z.number().nullable(),
  p75_eur_m2: z.number().nullable(),
});

const pricePerM2Output = obj({
  source: z.string(),
  query: obj({
    resolved_address: z.string(),
    scope: z.string(),
    type_local: z.string(),
    years: z.array(z.number()),
  }),
  all_period: priceStats,
  last_12_months: priceStats.extend({ window: z.string() }).nullable(),
  by_year: z.record(
    z.string(),
    obj({ sales: z.number(), median_eur_m2: z.number().nullable() }),
  ),
  note: z.string(),
});

/* --------------------------------------------------------------- valuation */

const estimateRange = obj({ estimate: z.number(), low: z.number(), high: z.number() });

const compView = obj({
  date: z.string(),
  address: z.string(),
  distance_m: z.number(),
  surface_m2: z.number().nullable(),
  rooms: z.number().nullable(),
  price_eur: z.number().nullable(),
  price_m2: z.number(),
  price_m2_adjusted: z.number().describe("Comp price expressed at current market level"),
  year_adjustment: z.number(),
  weight: z.number().describe("Share of the heaviest comp's weight (1 = the heaviest)"),
});

const estimate = obj({
  per_m2: estimateRange,
  value_eur: estimateRange,
  confidence,
  comps_used: z.number(),
  effective_sample_size: z.number().describe("Kish effective size: (Σw)²/Σw²"),
  reference_year: z.number(),
  year_medians_eur_m2: z.record(z.string(), z.number()),
  top_comps: z.array(compView),
});

const propertyTaxComponent = obj({
  code: z.string(),
  label: z.string(),
  amount_eur: z.number().nullable(),
  taxable_articles: z.number().nullable(),
  average_charge_eur: z.number().nullable(),
});

const propertyTaxEstimate = obj({
  source: z.string(),
  source_url: z.string(),
  insee_code: z.string(),
  year: z.number(),
  typical_annual_charge_eur: z
    .number()
    .describe("Average charge per taxable article in the commune, not an individual tax bill"),
  components: z.array(propertyTaxComponent),
  coverage: z.enum(["complete", "partial"]),
  caveats: z.array(z.string()),
});

const propertyTaxEstimateOutput = obj({
  query: obj({ resolved_location: z.string(), insee_code: z.string() }),
}).merge(propertyTaxEstimate);

const rentIndicatorView = obj({
  rent_eur_m2_month: z.number(),
  range_eur_m2_month: z.tuple([z.number(), z.number()]),
  scope: z.string(),
  listings_observed: z.number(),
  estimated_monthly_rent_eur: z.number().optional(),
});

const rentEstimateOutput = obj({
  source: z.string(),
  location: z.string(),
  insee_code: z.string(),
  year: z.number(),
  indicators: z.record(z.string(), rentIndicatorView.nullable()),
  note: z.string(),
});

const rental = obj({
  source: z.string(),
  indicator: rentKind,
  scope: z.string(),
  rent_eur_m2_month: z.number(),
  range_eur_m2_month: z.tuple([z.number(), z.number()]),
  estimated_monthly_rent_eur: z.number(),
  gross_yield_pct: z.number(),
  property_tax_average: propertyTaxEstimate.optional(),
  net_yield_after_average_property_tax_pct: z.number().optional(),
});

const estimatePropertyOutput = obj({
  source: z.string(),
  query: obj({
    resolved_address: z.string(),
    type_local: z.string(),
    surface_m2: z.number(),
    communes_searched: z.array(z.string()),
  }),
  estimate,
  rental: rental.nullable(),
  caveats: z.array(z.string()),
});

/* ----------------------------------------------------------------- context */

const dpeRecord = obj({
  adresse_ban: z.string().optional(),
  identifiant_ban: z.string().optional(),
  etiquette_dpe: z.string().optional().describe("Energy label, A best to G worst"),
  etiquette_ges: z.string().optional().describe("Greenhouse-gas label"),
  type_batiment: z.string().optional(),
  annee_construction: z.number().optional(),
  surface_habitable_logement: z.number().optional(),
  date_etablissement_dpe: z.string().optional(),
  conso_5_usages_par_m2_ep: z.number().optional().describe("Primary energy, kWh/m²/year"),
  dataset: z.enum(["existant", "neuf"]).optional(),
});

const dpeLookupOutput = obj({
  source: z.string(),
  query: obj({ resolved_address: z.string(), ban_id: z.string().nullable() }),
  total_found: z.number(),
  by_dataset: z.array(
    obj({
      dataset: z.enum(["existant", "neuf"]),
      label: z.string(),
      match: z.enum(["exact BAN id", "address search"]),
      total_found: z.number(),
    }),
  ),
  diagnostics: z.array(dpeRecord),
  note: z.string(),
});

const riskAtAddress = obj({
  risk: z.string(),
  statusAtAddress: z.string().nullable(),
  statusInCommune: z.string().nullable(),
});

const naturalRisksOutput = obj({
  source: z.string(),
  resolved_address: z.string().nullable(),
  available: z
    .boolean()
    .describe("false means Géorisques could not be reached: the risk status is UNKNOWN, not risk-free"),
  address: z.string().nullable(),
  commune: z.string().nullable(),
  naturalRisks: z.array(riskAtAddress),
  technologicalRisks: z.array(riskAtAddress),
  officialReportUrl: z.string().nullable(),
  unavailable: obj({ reason: z.string(), portal_url: z.string() }).optional(),
  note: z.string(),
});

const communeView = obj({
  nom: z.string(),
  insee_code: z.string(),
  postcodes: z.array(z.string()).optional(),
  departement: obj({ code: z.string(), nom: z.string() }).optional(),
  region: obj({ code: z.string(), nom: z.string() }).optional(),
  population: z.number().optional(),
  surface_km2: z.number().optional(),
  center: point.optional(),
});

const communeInfoOutput = obj({
  source: z.string(),
  communes: z.array(communeView),
});

const cadastralParcel = obj({
  idu: z.string().describe("Unique cadastral id quoted on deeds, e.g. 69382000AB0062"),
  section: z.string().nullable(),
  numero: z.string().nullable(),
  contenance_m2: z
    .number()
    .nullable()
    .describe("Cadastral taxed area of the whole parcel, land included — not habitable surface"),
  code_insee: z.string().nullable(),
  commune: z.string().nullable(),
  com_abs: z.string().nullable(),
  approx_center: point.nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const cadastralParcelOutput = obj({
  source: z.string(),
  source_url: z.string(),
  resolved_address: z.string().nullable(),
  point,
  parcels_found: z.number(),
  parcels: z.array(cadastralParcel),
  note: z.string(),
  caveats: z.array(z.string()),
});

const urbanismZone = obj({
  label: z.string().nullable(),
  description: z.string().nullable(),
  type: z.string().nullable().describe("U urban, AU to be urbanised, A agricultural, N natural"),
  partition: z.string().nullable(),
  document_id: z.string().nullable(),
  document_valid_from: z.string().nullable(),
  regulation_file: z.string().nullable(),
  document_url: z.string().nullable(),
});

const urbanismPrescription = obj({
  label: z.string().nullable(),
  type_code: z.string().nullable(),
  subtype_code: z.string().nullable(),
  geometry_kind: z.enum(["surf", "lin", "pct"]),
  value: z.string().nullable(),
  document_id: z.string().nullable(),
  document_valid_from: z.string().nullable(),
  regulation_file: z.string().nullable(),
});

const urbanismZoningOutput = obj({
  source: z.string(),
  source_url: z.string(),
  resolved_address: z.string().nullable(),
  point,
  zoning_areas: z.array(urbanismZone),
  prescriptions: z.array(urbanismPrescription),
  coverage_note: z.string().optional(),
  note: z.string(),
  caveats: z.array(z.string()),
});

const irisArea = obj({
  code_iris: z.string().describe("9-character INSEE IRIS code, commune code plus 4 digits"),
  name: z.string().nullable(),
  type: z.string().nullable(),
  code_insee: z.string(),
  commune: z.string().nullable(),
});

const irisLookupOutput = obj({
  source: z.string(),
  source_url: z.string(),
  resolved_address: z.string(),
  point,
  iris: irisArea.nullable(),
  note: z.string(),
  caveats: z.array(z.string()),
});

/**
 * Rent control answers two genuinely different things, so the schema is one
 * object with a discriminator rather than a union: a union would produce an
 * `anyOf` at the root, and MCP expects a tool's output schema to describe an
 * object. `covered: false` means "no published grid here" — never "no rule
 * applies".
 */
const rentControlValues = obj({
  reference_eur_m2_month: z.number().nullable(),
  ceiling_eur_m2_month: z.number().nullable().describe("Loyer de référence majoré: a legal ceiling"),
  floor_eur_m2_month: z.number().nullable(),
});

const rentControlOutput = obj({
  query: obj({
    resolved_address: z.string(),
    insee_code: z.string(),
    iris_code: z.string().nullable(),
    rooms: z.number().nullable(),
    furnished: z.boolean().nullable(),
    period: z.string().nullable(),
  }),
  covered: z.boolean(),
  city: z.string().optional(),
  area_label: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  rooms: z.number().nullable().optional(),
  period: z.string().nullable().optional(),
  furnished: z.boolean().nullable().optional(),
  values: rentControlValues.optional(),
  matched: z.enum(["exact", "closest"]).optional(),
  source: z.string(),
  source_url: z.string().optional(),
  covered_cities: z.array(z.string()).optional(),
  note: z.string(),
  caveats: z.array(z.string()).optional(),
});

/* --------------------------------------------------------------- backtest */

const backtestMetrics = obj({
  observations: z.number(),
  mape_pct: z.number().nullable(),
  median_ape_pct: z.number().nullable(),
  p90_ape_pct: z.number().nullable(),
  bias_pct: z.number().nullable().describe("Signed mean error: > 0 means the model over-estimates"),
  interval_coverage_pct: z.number().nullable().describe("Share of prices inside the P25–P75 range"),
});

const backtestObservation = obj({
  id: z.string(),
  date: z.string(),
  surface_m2: z.number(),
  band: z.enum(["lt35", "35_60", "60_90", "90_140", "gte140"]),
  actual_eur_m2: z.number(),
  predicted_eur_m2: z.number(),
  low_eur_m2: z.number(),
  high_eur_m2: z.number(),
  abs_pct_error: z.number(),
  signed_pct_error: z.number(),
  within_range: z.boolean(),
  comps_used: z.number(),
  effective_sample_size: z.number(),
  confidence,
});

const backtestEstimatorOutput = obj({
  source: z.string(),
  query: obj({
    resolved_address: z.string(),
    type_local: z.string(),
    communes_searched: z.array(z.string()),
    from_year: z.number().nullable(),
    to_year: z.number().nullable(),
  }),
  method: z.string(),
  type: z.string(),
  candidates: z.number(),
  evaluated: z.number(),
  skipped_not_estimable: z.number(),
  year_range: z.tuple([z.number(), z.number()]).nullable(),
  overall: backtestMetrics,
  by_surface_band: z.record(z.string(), backtestMetrics),
  by_year: z.record(z.string(), backtestMetrics),
  worst_cases: z.array(backtestObservation),
  caveats: z.array(z.string()),
});

/* ---------------------------------------------------------------- report */

/**
 * `property_report` isolates its sections: any of them can come back as
 * `{ error }` without failing the call. The schema says exactly that.
 */
export const section = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, obj({ error: z.string() })]);

const propertyReportOutput = obj({
  resolved_address: z.string(),
  market: section(pricePerM2Output),
  recent_sales_nearby: section(propertySalesOutput),
  valuation: section(estimatePropertyOutput).nullable(),
  rent: section(rentEstimateOutput),
  rent_control: section(rentControlOutput),
  property_tax: section(propertyTaxEstimateOutput),
  cadastre: section(cadastralParcelOutput),
  urbanism: section(urbanismZoningOutput),
  iris: section(irisLookupOutput),
  energy_diagnostics: section(dpeLookupOutput),
  risks: section(naturalRisksOutput),
  commune: section(communeInfoOutput),
  generated_from: z.string(),
});

/* -------------------------------------------------------------- registry */

/**
 * One entry per tool, in `registerTool` order, and the single source of truth
 * for what each tool promises to return.
 *
 * These are handed to `registerTool` as object *schemas* rather than as raw
 * shapes on purpose: a raw shape is rebuilt by the SDK into a fresh `z.object`,
 * which would silently drop the passthrough policy above and republish every
 * payload as `additionalProperties: false`.
 */
export const OUTPUT_SCHEMAS = {
  geocode_address: geocodeOutput,
  property_sales: propertySalesOutput,
  price_per_m2: pricePerM2Output,
  estimate_property: estimatePropertyOutput,
  rent_estimate: rentEstimateOutput,
  property_tax_estimate: propertyTaxEstimateOutput,
  property_report: propertyReportOutput,
  dpe_lookup: dpeLookupOutput,
  natural_risks: naturalRisksOutput,
  commune_info: communeInfoOutput,
  reverse_geocode: geocodeOutput,
  backtest_estimator: backtestEstimatorOutput,
  cadastral_parcel: cadastralParcelOutput,
  urbanism_zoning: urbanismZoningOutput,
  iris_lookup: irisLookupOutput,
  rent_control: rentControlOutput,
} satisfies Record<string, z.AnyZodObject>;

export type ToolName = keyof typeof OUTPUT_SCHEMAS;

/** Individual sections of `property_report`, reusable on their own. */
export const reportSections = {
  market: pricePerM2Output,
  recent_sales_nearby: propertySalesOutput,
  valuation: estimatePropertyOutput,
  rent: rentEstimateOutput,
  rent_control: rentControlOutput,
  property_tax: propertyTaxEstimateOutput,
  cadastre: cadastralParcelOutput,
  urbanism: urbanismZoningOutput,
  iris: irisLookupOutput,
  energy_diagnostics: dpeLookupOutput,
  risks: naturalRisksOutput,
  commune: communeInfoOutput,
} satisfies Record<string, z.ZodTypeAny>;
