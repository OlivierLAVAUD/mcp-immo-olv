import { fetchJson } from "../http.js";

/**
 * ADEME publishes two DPE datasets that share exactly the same schema:
 *  - `dpe03existant` — diagnostics filed for existing dwellings (since 2021);
 *  - `dpe02neuf`     — diagnostics filed for new dwellings.
 * Querying both is the difference between "no DPE on file" and "no *existing*
 * DPE on file, but this building is new".
 */
export const DPE_DATASETS = {
  existant: "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines",
  neuf: "https://data.ademe.fr/data-fair/api/v1/datasets/dpe02neuf/lines",
} as const;
export type DpeDataset = keyof typeof DPE_DATASETS;
export const DPE_DATASET_LABELS: Record<DpeDataset, string> = {
  existant: "DPE logements existants (ADEME)",
  neuf: "DPE logements neufs (ADEME)",
};
export const DPE_DATASET_ORDER: DpeDataset[] = ["existant", "neuf"];

const SELECT = [
  "adresse_ban",
  "identifiant_ban",
  "etiquette_dpe",
  "etiquette_ges",
  "type_batiment",
  "annee_construction",
  "surface_habitable_logement",
  "date_etablissement_dpe",
  "conso_5_usages_par_m2_ep",
].join(",");

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

interface DpeResponse {
  total: number;
  results: DpeRecord[];
}

/** Exact match on the BAN interoperability id (e.g. "75102_6998_00010"). */
export async function dpeByBanId(
  banId: string,
  size = 20,
  dataset: DpeDataset = "existant",
): Promise<DpeResponse> {
  const url = `${DPE_DATASETS[dataset]}?size=${size}&qs=${encodeURIComponent(`identifiant_ban:"${banId}"`)}&select=${SELECT}&sort=-date_etablissement_dpe`;
  return fetchJson<DpeResponse>(url);
}

/** Fuzzy search on the BAN address, restricted to one commune. */
export async function dpeByAddress(
  address: string,
  inseeCode: string,
  size = 20,
  dataset: DpeDataset = "existant",
): Promise<DpeResponse> {
  const params = new URLSearchParams({
    size: String(size),
    q: address,
    q_fields: "adresse_ban",
    qs: `code_insee_ban:"${inseeCode}"`,
    select: SELECT,
    sort: "-date_etablissement_dpe",
  });
  return fetchJson<DpeResponse>(`${DPE_DATASETS[dataset]}?${params.toString()}`);
}
