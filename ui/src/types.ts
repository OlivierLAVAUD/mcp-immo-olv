/**
 * Shapes returned by the OLV Immo MCP tools.
 *
 * Every field is optional on purpose: `property_report` runs its sections in
 * parallel and lets them fail independently, so any block can arrive as
 * `{ error: "..." }` instead of data. Callers narrow with `isErrorBlock()`.
 */

export interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
  enum?: string[];
  items?: JsonSchemaProp;
  anyOf?: JsonSchemaProp[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface Health {
  ok: boolean;
  error?: string;
  server?: { name?: string; version?: string } | null;
  toolCount?: number;
  serverEntry?: string;
  consoleBuilt?: boolean;
  callTimeoutMs?: number;
}

export interface CallResult {
  ok: boolean;
  tool: string;
  isError?: boolean;
  text?: string;
  data?: unknown;
  error?: string;
  durationMs?: number | null;
}

/** A section that failed on its own. */
export interface ErrorBlock {
  error: string;
}

export function isErrorBlock(value: unknown): value is ErrorBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

// --------------------------------------------------------------------- market

export interface StatsBlock {
  sales: number;
  median_eur_m2: number;
  mean_eur_m2: number;
  p25_eur_m2: number;
  p75_eur_m2: number;
}

export interface MarketBlock {
  source?: string;
  query?: { resolved_address?: string; scope?: string; type_local?: string; years?: number[] };
  all_period?: StatsBlock;
  last_12_months?: (StatsBlock & { window?: string }) | null;
  by_year?: Record<string, { sales: number; median_eur_m2: number }>;
  note?: string;
}

// ---------------------------------------------------------------------- sales

export interface Dwelling {
  type?: string;
  surface?: number | null;
  rooms?: number | null;
}

export interface Sale {
  date?: string;
  nature?: string;
  price_eur?: number | null;
  addresses?: string[];
  dwellings?: Dwelling[];
  other_locals?: unknown[];
  land_surface_m2?: number | null;
  price_per_m2?: number | null;
}

export interface SalesBlock {
  source?: string;
  query?: { resolved_address?: string; scope?: string; years?: number[] };
  total_matching_sales?: number;
  sales?: Sale[];
  note?: string;
}

// ------------------------------------------------------------------ valuation

export interface Comp {
  date?: string;
  address?: string;
  distance_m?: number;
  surface_m2?: number | null;
  rooms?: number | null;
  price_eur?: number | null;
  price_m2?: number;
  price_m2_adjusted?: number;
  year_adjustment?: number;
  weight?: number;
}

export interface Estimate {
  per_m2?: { estimate: number; low: number; high: number };
  value_eur?: { estimate: number; low: number; high: number };
  confidence?: "high" | "medium" | "low";
  comps_used?: number;
  effective_sample_size?: number;
  reference_year?: number;
  year_medians_eur_m2?: Record<string, number>;
  top_comps?: Comp[];
}

export interface PropertyTaxComponent {
  code?: string;
  label?: string;
  amount_eur?: number | null;
  taxable_articles?: number | null;
  average_charge_eur?: number | null;
}

export interface PropertyTaxBlock {
  source?: string;
  source_url?: string;
  insee_code?: string;
  year?: number;
  typical_annual_charge_eur?: number;
  components?: PropertyTaxComponent[];
  coverage?: "complete" | "partial";
  caveats?: string[];
}

export interface RentalAngle {
  source?: string;
  indicator?: string;
  scope?: string;
  rent_eur_m2_month?: number;
  range_eur_m2_month?: [number, number];
  estimated_monthly_rent_eur?: number;
  gross_yield_pct?: number;
  property_tax_average?: PropertyTaxBlock;
  net_yield_after_average_property_tax_pct?: number;
}

export interface ValuationBlock {
  source?: string;
  query?: {
    resolved_address?: string;
    type_local?: string;
    surface_m2?: number;
    communes_searched?: string[];
  };
  estimate?: Estimate;
  rental?: RentalAngle | null;
  caveats?: string[];
}

// ----------------------------------------------------------------------- rent

export interface RentIndicatorBlock {
  rent_eur_m2_month?: number;
  range_eur_m2_month?: [number, number];
  scope?: string;
  listings_observed?: number;
  estimated_monthly_rent_eur?: number;
}

export interface RentBlock {
  source?: string;
  location?: string;
  insee_code?: string;
  year?: number;
  indicators?: Record<string, RentIndicatorBlock | null>;
  note?: string;
}

// ------------------------------------------------------------------------ dpe

export interface DpeRecord {
  adresse_ban?: string;
  identifiant_ban?: string;
  etiquette_dpe?: string;
  etiquette_ges?: string;
  type_batiment?: string;
  annee_construction?: number;
  surface_habitable_logement?: number;
  date_etablissement_dpe?: string;
  conso_5_usages_par_m2_ep?: number;
}

export interface DpeBlock {
  source?: string;
  query?: { resolved_address?: string; ban_id?: string | null; match?: string };
  total_found?: number;
  diagnostics?: DpeRecord[];
  note?: string;
}

// ---------------------------------------------------------------------- risks

export interface RiskEntry {
  risk?: string;
  statusAtAddress?: string | null;
  statusInCommune?: string | null;
}

export interface RisksBlock {
  source?: string;
  resolved_address?: string | null;
  address?: string | null;
  commune?: string | null;
  naturalRisks?: RiskEntry[];
  technologicalRisks?: RiskEntry[];
  officialReportUrl?: string | null;
  /** false when Géorisques did not answer: the empty lists mean "unknown", not "no risk". */
  available?: boolean;
  unavailable?: { reason: string; portal_url: string };
}

// -------------------------------------------------------------------- commune

export interface Commune {
  nom?: string;
  insee_code?: string;
  postcodes?: string[];
  /** geo.api.gouv.fr returns these as {code, nom} objects; tolerate a plain string too. */
  departement?: string | { code?: string; nom?: string };
  region?: string | { code?: string; nom?: string };
  population?: number;
  surface_km2?: number;
  center?: { lat: number; lon: number };
}

export interface CommuneBlock {
  source?: string;
  communes?: Commune[];
}

// --------------------------------------------------------------------- report

export interface PropertyReport {
  resolved_address?: string;
  market?: MarketBlock | ErrorBlock;
  recent_sales_nearby?: SalesBlock | ErrorBlock;
  valuation?: ValuationBlock | ErrorBlock | null;
  rent?: RentBlock | ErrorBlock;
  property_tax?: PropertyTaxBlock | ErrorBlock;
  energy_diagnostics?: DpeBlock | ErrorBlock;
  risks?: RisksBlock | ErrorBlock;
  commune?: CommuneBlock | ErrorBlock;
  generated_from?: string;
}
