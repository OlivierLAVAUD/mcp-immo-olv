import { fetchJson } from "../http.js";
import { departementFromInsee, parentCommuneCode } from "../util/geo.js";

/**
 * Rent control — "encadrement des loyers".
 *
 * Where it applies, a loyer de référence is published per neighbourhood, per
 * number of rooms, per construction period and per furnished/unfurnished
 * status. The legal ceiling is that reference +20 % (`loyer de référence
 * majoré`); below it, a *complément de loyer* is only lawful for genuinely
 * exceptional dwellings.
 *
 * There is no single national machine-readable dataset: each authority
 * publishes its own, in its own shape. This module keeps a small, explicit
 * registry of adapters and — crucially — answers "not covered here" instead of
 * inventing a ceiling for a commune it does not know.
 */
export const RENT_CONTROL_SOURCE =
  "Encadrement des loyers — loyers de référence publiés par les collectivités (données ouvertes)";
export const RENT_CONTROL_NOTE =
  "Values are €/m²/month, charges included. The ceiling is the loyer de référence majoré; the floor matches the loyer de référence minoré.";

export interface RentControlQuery {
  rooms?: number;
  furnished?: boolean;
  /** Construction period label, e.g. "1946-1970". */
  period?: string;
}

export interface RentControlValues {
  reference_eur_m2_month: number | null;
  ceiling_eur_m2_month: number | null;
  floor_eur_m2_month: number | null;
}

export interface RentControlResult {
  city: string;
  area_label: string | null;
  year: string | null;
  rooms: number | null;
  period: string | null;
  furnished: boolean | null;
  values: RentControlValues;
  matched: "exact" | "closest";
  source: string;
  source_url: string;
  note: string;
  caveats: string[];
}

const CAVEATS = [
  "This is the public reference grid for the neighbourhood, not a ruling on a specific lease: the applicable rent also depends on the dwelling's characteristics and the lease's start date.",
  "A loyer de référence majoré is a ceiling, not the market price — do not read it as an expected rent.",
  "Only communes whose authority publishes an open reference grid are covered; the response says explicitly when a commune is not.",
];

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const isFurnishedLabel = (label: string): boolean => /meubl|furnish/i.test(label) && !/non[- ]/i.test(label);

// ------------------------------------------------------------------- Paris

const PARIS_RECORDS_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/logement-encadrement-des-loyers/records";
export const PARIS_RENT_CONTROL_URL =
  "https://www.paris.fr/pages/l-encadrement-des-loyers-5995";

export interface ParisRentRecord {
  annee?: string;
  piece?: number;
  epoque?: string;
  meuble_txt?: string;
  ref?: number;
  min?: number;
  max?: number;
  nom_quartier?: string;
  code_grand_quartier?: number;
}

/**
 * Pick the row that best matches the query: latest year first, then the closest
 * room count, then the requested furnished status and period. Pure and tested.
 */
export function pickParisRecord(
  records: ParisRentRecord[],
  query: RentControlQuery,
): ParisRentRecord | null {
  if (records.length === 0) return null;

  const years = records.map((r) => Number(r.annee)).filter((y) => Number.isFinite(y));
  const latestYear = years.length > 0 ? Math.max(...years) : null;
  const pool =
    latestYear === null ? records : records.filter((r) => Number(r.annee) === latestYear);

  const score = (r: ParisRentRecord): number => {
    let s = 0;
    if (query.rooms !== undefined) {
      if (r.piece === query.rooms) s += 4;
      else if (r.piece !== undefined) s -= Math.min(3, Math.abs(r.piece - query.rooms));
    }
    if (query.furnished !== undefined && r.meuble_txt !== undefined) {
      if (isFurnishedLabel(r.meuble_txt) === query.furnished) s += 2;
    }
    if (query.period !== undefined && r.epoque === query.period) s += 1;
    if (r.ref !== undefined) s += 0.5; // prefer a row that actually carries a value
    return s;
  };

  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  return best ?? null;
}

export async function parisRentControl(
  lat: number,
  lon: number,
  query: RentControlQuery,
): Promise<RentControlResult | null> {
  const params = new URLSearchParams({
    where: `intersects(geo_shape,geom'POINT(${lon} ${lat})')`,
    select: "annee,piece,epoque,meuble_txt,ref,min,max,nom_quartier,code_grand_quartier",
    limit: "100",
    order_by: "annee desc",
  });
  const data = await fetchJson<{ results?: ParisRentRecord[] }>(
    `${PARIS_RECORDS_URL}?${params.toString()}`,
    24 * 60 * 60_000,
  );
  const record = pickParisRecord(data.results ?? [], query);
  if (!record) return null;

  const exact =
    (query.rooms === undefined || record.piece === query.rooms) &&
    (query.period === undefined || record.epoque === query.period) &&
    (query.furnished === undefined ||
      record.meuble_txt === undefined ||
      isFurnishedLabel(record.meuble_txt) === query.furnished);

  return {
    city: "Paris",
    area_label: record.nom_quartier ?? null,
    year: record.annee ?? null,
    rooms: record.piece ?? null,
    period: record.epoque ?? null,
    furnished: record.meuble_txt !== undefined ? isFurnishedLabel(record.meuble_txt) : null,
    values: {
      reference_eur_m2_month: numberOrNull(record.ref),
      ceiling_eur_m2_month: numberOrNull(record.max),
      floor_eur_m2_month: numberOrNull(record.min),
    },
    matched: exact ? "exact" : "closest",
    source: RENT_CONTROL_SOURCE,
    source_url: PARIS_RENT_CONTROL_URL,
    note: RENT_CONTROL_NOTE,
    caveats: CAVEATS,
  };
}
// --------------------------------------------------------------------- Lyon

/**
 * The Métropole de Lyon republishes its grid every year as a WFS layer whose
 * name embeds the period (`carencadrmtloyer_2025_2026`). Rather than hardcoding
 * a name that expires, resolve the newest dataset through the data.gouv.fr API
 * and read the layer name out of its resource URL.
 */
const DATA_GOUV_SEARCH =
  "https://www.data.gouv.fr/api/1/datasets/?q=Encadrement%20des%20loyers%20M%C3%A9tropole%20de%20Lyon&page_size=20";
const LYON_WFS_BASE = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows";
export const LYON_RENT_CONTROL_URL = "https://www.grandlyon.com/services/encadrement-des-loyers";

export interface LyonValue {
  loyer_reference?: number;
  loyer_reference_majore?: number;
  loyer_reference_minore?: number;
  majoration_unitaire?: number;
}

export type LyonValeurs = Record<string, Record<string, Record<string, LyonValue>>>;

/** Read the WFS layer name out of a data.gouv resource URL. */
export function lyonTypenameFromUrl(url: string): string | null {
  const match = /[?&]typename=([^&]+)/i.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Latest year mentioned in a dataset title, e.g. "… 2025-2026" -> 2026. */
export function latestPeriodYear(title: string): number | null {
  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  return years.length > 0 ? Math.max(...years) : null;
}

interface DataGouvDataset {
  title?: string;
  resources?: { url?: string }[];
}

let lyonTypeNameCache: { at: number; value: string | null } | null = null;

export async function lyonTypeName(): Promise<string | null> {
  if (lyonTypeNameCache && Date.now() - lyonTypeNameCache.at < 24 * 60 * 60_000) {
    return lyonTypeNameCache.value;
  }
  const data = await fetchJson<{ data?: DataGouvDataset[] }>(DATA_GOUV_SEARCH, 24 * 60 * 60_000);
  const candidates = (data.data ?? [])
    .filter((dataset) => /m[ée]tropole de lyon/i.test(dataset.title ?? ""))
    .map((dataset) => ({ dataset, year: latestPeriodYear(dataset.title ?? "") ?? 0 }))
    .sort((a, b) => b.year - a.year);

  const value =
    candidates
      .map((candidate) =>
        (candidate.dataset.resources ?? [])
          .map((r) => lyonTypenameFromUrl(r.url ?? ""))
          .find(Boolean),
      )
      .find(Boolean) ?? null;

  lyonTypeNameCache = { at: Date.now(), value };
  return value;
}

interface LyonFeature {
  properties?: { codeiris?: number | string; zonage?: number | string; valeurs?: LyonValeurs };
}

interface LyonResponse {
  features?: LyonFeature[];
}

/**
 * Walk the Lyon grid: rooms -> construction period -> furnished status. Missing
 * query fields fall back to the first available key, and the caller is told
 * whether the match was exact. Pure and unit-tested.
 */
export function pickLyonValues(
  valeurs: LyonValeurs | undefined,
  query: RentControlQuery,
): { rooms: number; period: string; furnished: boolean; values: RentControlValues } | null {
  if (!valeurs) return null;

  const roomKeys = Object.keys(valeurs).filter((k) => Number.isFinite(Number(k)));
  if (roomKeys.length === 0) return null;
  const fallbackRooms = Number(roomKeys[0]);
  const rooms =
    query.rooms !== undefined && valeurs[String(query.rooms)]
      ? String(query.rooms)
      : [...roomKeys].sort(
          (a, b) =>
            Math.abs(Number(a) - (query.rooms ?? fallbackRooms)) -
            Math.abs(Number(b) - (query.rooms ?? fallbackRooms)),
        )[0];

  const byPeriod = valeurs[rooms] ?? {};
  const periodKeys = Object.keys(byPeriod);
  if (periodKeys.length === 0) return null;
  const period = query.period !== undefined && byPeriod[query.period] ? query.period : periodKeys[0];

  const byFurnished = byPeriod[period] ?? {};
  const furnishedKeys = Object.keys(byFurnished);
  const wanted = query.furnished ?? false;
  const furnishedKey = furnishedKeys.find((k) => isFurnishedLabel(k) === wanted) ?? furnishedKeys[0];
  const entry = byFurnished[furnishedKey];
  if (!entry) return null;

  return {
    rooms: Number(rooms),
    period,
    furnished: isFurnishedLabel(furnishedKey),
    values: {
      reference_eur_m2_month: numberOrNull(entry.loyer_reference),
      ceiling_eur_m2_month: numberOrNull(entry.loyer_reference_majore),
      floor_eur_m2_month: numberOrNull(entry.loyer_reference_minore),
    },
  };
}

export async function lyonRentControl(
  codeIris: string,
  query: RentControlQuery,
): Promise<RentControlResult | null> {
  const typename = await lyonTypeName();
  if (!typename) return null;

  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    request: "GetFeature",
    typename,
    outputFormat: "application/json",
    CQL_FILTER: `codeiris=${Number(codeIris)}`,
  });
  const data = await fetchJson<LyonResponse>(
    `${LYON_WFS_BASE}?${params.toString()}`,
    24 * 60 * 60_000,
  );
  const feature = (data.features ?? [])[0];
  const picked = pickLyonValues(feature?.properties?.valeurs, query);
  if (!picked) return null;

  const exact =
    (query.rooms === undefined || query.rooms === picked.rooms) &&
    (query.period === undefined || query.period === picked.period) &&
    (query.furnished === undefined || query.furnished === picked.furnished);

  return {
    city: "Métropole de Lyon",
    area_label:
      feature?.properties?.zonage !== undefined ? `zonage ${feature.properties.zonage}` : null,
    year: null,
    rooms: picked.rooms,
    period: picked.period,
    furnished: picked.furnished,
    values: picked.values,
    matched: exact ? "exact" : "closest",
    source: RENT_CONTROL_SOURCE,
    source_url: LYON_RENT_CONTROL_URL,
    note: RENT_CONTROL_NOTE,
    caveats: CAVEATS,
  };
}

// ----------------------------------------------------------------- registry

export interface RentControlNotCovered {
  covered: false;
  insee_code: string;
  source: string;
  covered_cities: string[];
  note: string;
}

export type RentControlOutcome = RentControlResult & { covered: true };

/**
 * Explicit registry of the areas whose authority publishes an open grid. A
 * commune that matches no entry gets an honest "not covered" answer rather than
 * a made-up ceiling.
 */
export const RENT_CONTROL_AREAS: {
  city: string;
  matches: (codeInsee: string) => boolean;
}[] = [
  { city: "Paris", matches: (code) => parentCommuneCode(code) === "75056" },
  { city: "Métropole de Lyon", matches: (code) => departementFromInsee(code) === "69" },
];

/**
 * Resolve the applicable reference grid for a point.
 *
 * `codeIris` is optional: Paris answers geometrically, while Lyon keys its grid
 * by IRIS code, so the caller passes the IRIS it already looked up.
 */
export async function rentControlAtPoint(
  lat: number,
  lon: number,
  codeInsee: string,
  query: RentControlQuery,
  codeIris?: string | null,
): Promise<RentControlOutcome | RentControlNotCovered> {
  const areas = RENT_CONTROL_AREAS.filter((area) => area.matches(codeInsee));
  if (areas.length === 0) {
    return {
      covered: false,
      insee_code: codeInsee,
      source: RENT_CONTROL_SOURCE,
      covered_cities: RENT_CONTROL_AREAS.map((area) => area.city),
      note: "This commune is not in the rent-control registry, or its authority does not publish an open reference grid.",
    };
  }

  for (const area of areas) {
    if (area.city === "Paris") {
      const result = await parisRentControl(lat, lon, query).catch(() => null);
      if (result) return { ...result, covered: true };
    }
    if (area.city === "Métropole de Lyon" && codeIris) {
      const result = await lyonRentControl(codeIris, query).catch(() => null);
      if (result) return { ...result, covered: true };
    }
  }

  return {
    covered: false,
    insee_code: codeInsee,
    source: RENT_CONTROL_SOURCE,
    covered_cities: RENT_CONTROL_AREAS.map((area) => area.city),
    note: "A rent-control area matched, but no reference row was published for this point (outside the zone, or the authority's grid does not cover it).",
  };
}

