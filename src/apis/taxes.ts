import { fetchJson } from "../http.js";
import { parentCommuneCode } from "../util/geo.js";
import { round } from "../util/stats.js";

/**
 * DGFiP's Recensement des Éléments d'Imposition (REI), queried through OFGL's
 * public data API. The REI is the official, commune-level tax dataset; OFGL
 * exposes it as queryable records so one request does not download its 100+ MB
 * annual CSV file.
 *
 * This is deliberately an *average charge per taxable article*, never a claim
 * about the taxe foncière of one specific flat. The actual bill depends on the
 * property's cadastral rental value, exemptions, ownership and assessment.
 */
const OFGL_REI_API = "https://data.ofgl.fr/api/records/1.0/search/";
export const PROPERTY_TAX_SOURCE =
  "REI (Recensement des éléments d'imposition à la fiscalité directe locale), DGFiP — queried through OFGL public data API";
export const PROPERTY_TAX_SOURCE_URL =
  "https://data.ofgl.fr/explore/dataset/rei/";

/** Latest verified REI vintage when this server version was released. */
export const PROPERTY_TAX_DEFAULT_YEAR = 2025;

interface ReiRecord {
  fields?: {
    annee?: string | number;
    idcom?: string;
    var?: string;
    varlib?: string;
    valeur?: number | string | null;
  };
}

interface ReiResponse {
  nhits?: number;
  records?: ReiRecord[];
}

export interface PropertyTaxComponent {
  code: string;
  label: string;
  amount_eur: number | null;
  taxable_articles: number | null;
  average_charge_eur: number | null;
}

export interface PropertyTaxEstimate {
  source: string;
  source_url: string;
  insee_code: string;
  year: number;
  typical_annual_charge_eur: number;
  components: PropertyTaxComponent[];
  coverage: "complete" | "partial";
  caveats: string[];
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function latestYear(records: ReiRecord[]): number | null {
  const years = records
    .map((r) => numberValue(r.fields?.annee))
    .filter((y): y is number => y !== null && Number.isInteger(y));
  return years.length > 0 ? Math.max(...years) : null;
}

function byCode(records: ReiRecord[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const record of records) {
    const code = record.fields?.var;
    const value = numberValue(record.fields?.valeur);
    if (code && value !== null) values.set(code, value);
  }
  return values;
}

interface ComponentDefinition {
  code: string;
  label: string;
  amountCode: string;
  articlesCode: string;
}

/**
 * REI field codes for taxes levied on built properties (FB): commune, GFP /
 * intercommunalité, syndicats, GEMAPI and household-waste levy (TEOM).
 */
const COMPONENTS: ComponentDefinition[] = [
  { code: "commune", label: "Part communale TFPB", amountCode: "E13", articlesCode: "E14" },
  {
    code: "intercommunality",
    label: "Part intercommunale TFPB",
    amountCode: "E33",
    // REI has no separately aligned GFP article count in every commune. The
    // commune's taxable-article count is the transparent common denominator.
    articlesCode: "E14",
  },
  {
    code: "syndicates",
    label: "Part syndicats TFPB",
    amountCode: "E23",
    articlesCode: "E14",
  },
  { code: "gemapi", label: "Part GEMAPI TFPB", amountCode: "E53gGEMAPI", articlesCode: "E54gGEMAPI" },
  { code: "teom", label: "TEOM", amountCode: "F13", articlesCode: "F14" },
];

/**
 * Turn an already fetched REI response into a useful, honest tax proxy.
 * Exported independently of HTTP for deterministic tests.
 */
export function summarizePropertyTax(
  inseeCode: string,
  records: ReiRecord[],
  requestedYear?: number,
): PropertyTaxEstimate | null {
  const year = requestedYear ?? latestYear(records);
  if (year === null) return null;

  const sameYear = records.filter((r) => Number(r.fields?.annee) === year);
  const values = byCode(sameYear);
  const components = COMPONENTS.map((definition) => {
    const amount = values.get(definition.amountCode) ?? null;
    const articles = values.get(definition.articlesCode) ?? null;
    return {
      code: definition.code,
      label: definition.label,
      amount_eur: amount === null ? null : round(amount, 0),
      taxable_articles: articles === null ? null : round(articles, 0),
      average_charge_eur:
        amount !== null && articles !== null && articles > 0 ? round(amount / articles, 0) : null,
    };
  });

  const known = components.filter((c) => c.average_charge_eur !== null);
  // No commune tax = no honest approximate annual charge to return.
  if (!components[0].average_charge_eur || known.length === 0) return null;

  const total = known.reduce((sum, component) => sum + component.average_charge_eur!, 0);
  const expected = COMPONENTS.length;
  return {
    source: PROPERTY_TAX_SOURCE,
    source_url: PROPERTY_TAX_SOURCE_URL,
    insee_code: inseeCode,
    year,
    typical_annual_charge_eur: round(total, 0)!,
    components,
    coverage: known.length === expected ? "complete" : "partial",
    caveats: [
      "This is the aggregate tax charge per taxable REI article in the commune, not an individual tax bill for the property.",
      "An actual taxe foncière depends on the cadastral rental value, exemptions, ownership and the assessment; use the avis de taxe foncière to underwrite a purchase.",
      "Components without a published amount or article count are excluded; coverage is declared explicitly.",
    ],
  };
}

/**
 * Return the latest available (or explicitly requested) commune-level tax
 * proxy. REI is annual: asking for a future year fails rather than pretending
 * the old rate is current.
 */
export async function propertyTaxByCommune(
  inseeCode: string,
  year?: number,
): Promise<PropertyTaxEstimate | null> {
  // BAN uses municipal arrondissement codes inside Paris/Lyon/Marseille,
  // while the REI tax rolls are held at the parent-commune level.
  const parentCode = parentCommuneCode(inseeCode);
  const params = new URLSearchParams({
    dataset: "rei",
    rows: "1000",
    "refine.idcom": parentCode,
  });
  if (year !== undefined) params.set("refine.annee", String(year));

  const response = await fetchJson<ReiResponse>(`${OFGL_REI_API}?${params.toString()}`, 24 * 60 * 60_000);
  return summarizePropertyTax(parentCode, response.records ?? [], year);
}
