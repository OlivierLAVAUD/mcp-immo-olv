import { fetchJson, HttpError, isRetryable } from "../http.js";

interface RiskEntry {
  present: boolean;
  libelle: string;
  libelleStatutCommune?: string | null;
  libelleStatutAdresse?: string | null;
}

interface RiskReport {
  adresse?: { libelle?: string };
  commune?: { libelle?: string; codePostal?: string; codeInsee?: string };
  url?: string;
  risquesNaturels?: Record<string, RiskEntry>;
  risquesTechnologiques?: Record<string, RiskEntry>;
}

export interface RiskAtAddress {
  risk: string;
  statusAtAddress: string | null;
  statusInCommune: string | null;
}

export interface SimplifiedRisks {
  /**
   * false when Géorisques could not be answered with. The risk arrays are then
   * empty because nothing is known — NOT because the address is risk-free.
   */
  available: boolean;
  address: string | null;
  commune: string | null;
  naturalRisks: RiskAtAddress[];
  technologicalRisks: RiskAtAddress[];
  officialReportUrl: string | null;
  /** Set only when `available` is false: why, and where to check by hand. */
  unavailable?: { reason: string; portal_url: string };
}

/** Public Géorisques entry point, used when the API itself will not answer. */
export const GEORISQUES_PORTAL = "https://www.georisques.gouv.fr/minformer-sur-un-risque";

const API = "https://www.georisques.gouv.fr/api/v1/resultats_rapport_risque";

function simplify(entries: Record<string, RiskEntry> | undefined): RiskAtAddress[] {
  if (!entries) return [];
  return Object.values(entries)
    .filter((e) => e && e.present)
    .map((e) => ({
      risk: e.libelle,
      statusAtAddress: e.libelleStatutAdresse ?? null,
      statusInCommune: e.libelleStatutCommune ?? null,
    }));
}

function describeFailure(e: unknown): string {
  if (e instanceof HttpError) return `Géorisques API returned HTTP ${e.status}`;
  return `Géorisques API unreachable: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * What we answer when the source is down: an explicit "unknown" rather than an
 * empty report.
 *
 * This matters more than it looks. An empty risk list is indistinguishable from
 * "Géorisques looked and found nothing", and a buyer reading that would conclude
 * the address is safe. Géorisques also returns HTTP 503 for whole-site
 * incidents, so this is a routine case, not a hypothetical one.
 */
export function unavailableRiskReport(reason: string): SimplifiedRisks {
  return {
    available: false,
    address: null,
    commune: null,
    naturalRisks: [],
    technologicalRisks: [],
    officialReportUrl: GEORISQUES_PORTAL,
    unavailable: { reason, portal_url: GEORISQUES_PORTAL },
  };
}

/** Full risk report for a point (Géorisques, Ministère de la Transition écologique). */
export async function riskReport(lat: number, lon: number): Promise<SimplifiedRisks> {
  const url = `${API}?latlon=${lon},${lat}`;

  let data: RiskReport;
  try {
    data = await fetchJson<RiskReport>(url);
  } catch (e) {
    // A 4xx still means we asked something wrong, so stay loud about it. A 5xx
    // or a dead socket means the service is down, which the caller must see as
    // "unknown" — never as an absence of risk.
    if (!isRetryable(e)) throw e;
    return unavailableRiskReport(describeFailure(e));
  }

  return {
    available: true,
    address: data.adresse?.libelle ?? null,
    commune: data.commune
      ? [data.commune.libelle, data.commune.codePostal].filter(Boolean).join(" ")
      : null,
    naturalRisks: simplify(data.risquesNaturels),
    technologicalRisks: simplify(data.risquesTechnologiques),
    officialReportUrl: data.url ?? null,
  };
}
