import { fetchJson } from "../http.js";

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

export interface SimplifiedRisks {
  address: string | null;
  commune: string | null;
  naturalRisks: { risk: string; statusAtAddress: string | null; statusInCommune: string | null }[];
  technologicalRisks: { risk: string; statusAtAddress: string | null; statusInCommune: string | null }[];
  officialReportUrl: string | null;
}

function simplify(entries: Record<string, RiskEntry> | undefined) {
  if (!entries) return [];
  return Object.values(entries)
    .filter((e) => e && e.present)
    .map((e) => ({
      risk: e.libelle,
      statusAtAddress: e.libelleStatutAdresse ?? null,
      statusInCommune: e.libelleStatutCommune ?? null,
    }));
}

/** Full risk report for a point (Géorisques, Ministère de la Transition écologique). */
export async function riskReport(lat: number, lon: number): Promise<SimplifiedRisks> {
  const url = `https://www.georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lon},${lat}`;
  const data = await fetchJson<RiskReport>(url);
  return {
    address: data.adresse?.libelle ?? null,
    commune: data.commune
      ? [data.commune.libelle, data.commune.codePostal].filter(Boolean).join(" ")
      : null,
    naturalRisks: simplify(data.risquesNaturels),
    technologicalRisks: simplify(data.risquesTechnologiques),
    officialReportUrl: data.url ?? null,
  };
}
