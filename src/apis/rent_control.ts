import { fetchJson, HttpError } from "../http.js";
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
// Checked live by the smoke test: a source URL we hand to a client is a
// deliverable, and the previous paris.fr path had gone 404.
export const PARIS_RENT_CONTROL_URL =
  "https://www.paris.fr/pages/l-encadrement-des-loyers-parisiens-en-vigueur-le-1er-aout-2712";

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
export const LYON_RENT_CONTROL_URL =
  "https://www.grandlyon.com/mes-services-au-quotidien/se-loger-ameliorer-ou-louer-son-logement/sinformer-sur-lencadrement-des-loyers";

export interface LyonValue {
  loyer_reference?: number;
  loyer_reference_majore?: number;
  loyer_reference_minore?: number;
  majoration_unitaire?: number;
}

export type LyonValeurs = Record<string, Record<string, Record<string, LyonValue>>>;

// ------------------------------------------------- xlsx reader (Montpellier)

/**
 * An .xlsx is a zip of XML files: `xl/sharedStrings.xml` holds the texts once
 * (cells reference them by index) and `xl/worksheets/sheetN.xml` holds one
 * sheet each. Node has no zip reader in scope and gains no dependency here —
 * the boilerplate below is the smallest honest reader for this fixed file:
 * entries are located through the central directory, inflated with the
 * platform `DecompressionStream`, and shared strings resolved by index.
 *
 * Two format decisions, both deliberate:
 *
 *  - Cells are placed by their **address letters** (`A1`, not position in the
 *    row): OOXML omits empty cells, so positional reading would shift
 *    everything after the first gap — and this workbook has gaps.
 *  - A missing entry *inside* a row becomes `""`, never a shifted column. The
 *    grid parser turns non-numeric values into `null`, and the shape guard
 *    rejects a sheet that does not look like the published grid.
 */
export interface XlsxSheet {
  /** Raw cell matrix of the sheet, header row first; dense by column letter. */
  cells: string[][];
}

interface XlsxZipEntry {
  dataOffset: number;
  length: number;
  method: number;
}

/** The zip central directory: entry name -> its bytes. */
function xlsxEntries(buffer: ArrayBuffer): Map<string, XlsxZipEntry> {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");

  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not an xlsx (no end of central directory)");

  const entries = new Map<string, XlsxZipEntry>();
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const headerOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(u8.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = view.getUint16(headerOffset + 26, true);
    const localExtraLen = view.getUint16(headerOffset + 28, true);
    entries.set(name, {
      dataOffset: headerOffset + 30 + localNameLen + localExtraLen,
      length: view.getUint32(offset + 24, true),
      method,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function xlsxInflate(buffer: ArrayBuffer, entry: XlsxZipEntry): Promise<string> {
  const slice = buffer.slice(entry.dataOffset, entry.dataOffset + entry.length);
  if (entry.method === 0) return new TextDecoder("utf-8").decode(slice);
  const stream = new Response(new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  return stream.text();
}

/** The plain texts of a workbook, indexed by shared-string reference. */
function xlsxSharedTexts(xml: string): string[] {
  const out: string[] = [];
  const itemRe = /<si>([\s\S]*?)<\/si>/g;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(xml)) !== null) {
    const texts: string[] = [];
    const textRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRe.exec(itemMatch[1])) !== null) texts.push(textMatch[1]);
    out.push(unescapeXml(texts.join("")));
  }
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** A column letter address (`A`, `Z`, `AA`…) -> zero-based column. */
function xlsxColumn(ref: string | null): number {
  const m = /^([A-Z]+)/.exec(ref ?? "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One sheet's rows as a dense matrix, addressed by cell letter. */
export function xlsxCellsOfSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const index = xlsxColumn(/\br="([^"]*)"/.exec(cellMatch[1])?.[1] ?? null);
      if (index < 0) continue;
      while (cells.length <= index) cells.push("");
      const raw = (cellMatch[2] ?? "").trim();
      // A shared-string cell holds an index; a missing index is data rot, and
      // the column stays empty rather than shifting its neighbours.
      cells[index] = /\bt="s"/.test(cellMatch[1]) ? (shared[Number(raw)] ?? "") : unescapeXml(raw);
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Fetch the grid workbook and unpack the five zone sheets into dense cell
 * matrices, header row first. Cached 24 h like every other slow layer — the
 * .xlsx is ~17 kB, so the prize is the round trip, not the bytes.
 */
export async function montpellierGridSheets(): Promise<XlsxSheet[]> {
  const res = await fetch(MONTPELLIER_GRID_URL);
  if (!res.ok) throw new HttpError(res.status, MONTPELLIER_GRID_URL);
  const buffer = await res.arrayBuffer();
  const entries = xlsxEntries(buffer);
  const readEntry = async (name: string): Promise<string> => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`xlsx entry missing from the grid workbook: ${name}`);
    return xlsxInflate(buffer, entry);
  };
  const shared = xlsxSharedTexts(await readEntry("xl/sharedStrings.xml"));
  const sheets: XlsxSheet[] = [];
  for (let n = 1; n <= MONTPELLIER_ZONE_NAMES.length; n++) {
    sheets.push({ cells: xlsxCellsOfSheet(await readEntry(`xl/worksheets/sheet${n}.xml`), shared) });
  }
  return sheets;
}

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

// ------------------------------------------------------------ Montpellier

const MONTPELLIER_BASE = "https://data.montpellier3m.fr/sites/default/files/ressources";
/**
 * The metropole's open layer: one authoritative workbook (Zone1..Zone5 sheets
 * are the per-zone grids) and one GeoJSON mapping each IRIS to an OLL zone
 * (`zone_oll`, 1–5). Stable paths from the open portal, published yearly.
 */
const MONTPELLIER_GRID_URL = `${MONTPELLIER_BASE}/MMM_MTP_Loyers.xlsx`;
const MONTPELLIER_ZONES_URL = `${MONTPELLIER_BASE}/MMM_MTP_Loyers.json`;
// Checked live by the smoke test, like its Paris and Lyon counterparts: the
// first guess (a montpellier3m.fr vanity path) 301-redirected to the home
// page, so the URL a client can check by hand is the city's own dossier.
export const MONTPELLIER_RENT_CONTROL_URL =
  "https://www.montpellier.fr/vie-quotidienne/vivre-ici/se-loger/lencadrement-des-loyers";

export interface MontpellierRow {
  /** 1 | 2 | 3 | 4, with "4 et plus" folded to 4. */
  rooms: number;
  /** "Avant 1946" | "1946-1970" | "1971-1990" | "1991-2005" | "Après 2005". */
  period: string;
  values: RentControlValues;
  /** The row for a furnished dwelling, from the meublé triplet. */
  furnished: RentControlValues;
}

/**
 * Pick the row that best matches the query inside one zone grid — closest
 * room count first, then the requested construction period, like Lyon walks
 * rooms -> period -> furnished status. Pure and unit-tested.
 */
export function pickMontpellierRow(rows: MontpellierRow[], query: RentControlQuery): MontpellierRow | null {
  if (rows.length === 0) return null;

  const wantedRooms = query.rooms ?? 1;
  const wantedPeriod = query.period;
  // Exact and closest periods come from the column headers themselves, so an
  // unknown label is simply not exact.
  return (
    [...rows].sort((a, b) => {
      const byRooms = Math.abs(a.rooms - wantedRooms) - Math.abs(b.rooms - wantedRooms);
      if (byRooms !== 0) return byRooms;
      if (wantedPeriod !== undefined) {
        const aExact = a.period === wantedPeriod ? 0 : 1;
        const bExact = b.period === wantedPeriod ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
      }
      return a.period < b.period ? -1 : a.period > b.period ? 1 : 0;
    })[0] ?? null
  );
}

/**
 * Read the zone mapping straight from the metropole's GeoJSON: one feature
 * per IRIS, `properties.zone_oll` carried by the value the portal itself
 * publishes. Cached 24 h like every other slow official layer.
 */
export async function montpellierZoning(): Promise<Record<string, number>> {
  const data = await fetchJson<{ features?: { properties?: Record<string, unknown> }[] }>(
    MONTPELLIER_ZONES_URL,
    24 * 60 * 60_000,
  );
  const zones: Record<string, number> = {};
  for (const feature of data.features ?? []) {
    const p = feature.properties ?? {};
    const code = typeof p.code_iris === "string" ? p.code_iris : null;
    const zone = typeof p.zone_oll === "number" ? p.zone_oll : null;
    if (code && zone !== null && zone >= 1 && zone <= 5) zones[code] = zone;
  }
  return zones;
}

/** The named sheets of the grid workbook: Zone1..Zone5, in that order. */
export const MONTPELLIER_ZONE_NAMES = ["Zone1", "Zone2", "Zone3", "Zone4", "Zone5"] as const;

/**
 * Montpellier: point -> zone from the IRIS, grid from the workbook.
 *
 * The metropole's authoritative layer is a workbook plus a zoned GeoJSON, so
 * this function takes the grid already extracted (`grids[zone]` is the raw
 * cell matrix of the ZoneN sheet, header row first) and parses it into rows —
 * fetching and unzipping the .xlsx stays in the handler, next to the URLs the
 * smoke test must keep checking. Each data row carries both triplets:
 * non-meublé, then meublé.
 *
 * The format guard is strict on purpose: a sheet that does not look like the
 * published grid (header lost, extra columns, five missing epochs) must stay
 * unread rather than misread. Montpellier publishes one fixed table per zone —
 * 4 room groups × 5 construction periods — and the code trusts exactly that.
 */
export function montpellierGridRows(grids: string[][][], zone: number): MontpellierRow[] {
  const grid = grids[zone - 1];
  if (!grid || grid.length < 2) return [];

  const header = grid[0];
  const expectHeader = (i: number, want: RegExp): boolean => want.test(header[i] ?? "");
  const shaped =
    header.length === 9 &&
    /^nb p/i.test(header[0] ?? "") &&
    /poq/i.test(header[1] ?? "") &&
    expectHeader(2, /f\.?\s*non/i) &&
    expectHeader(6, /f\.?\s*meubl/i);
  if (!shaped) return [];

  const num = (s: string | undefined): number | null => {
    if (s === undefined) return null;
    const v = Number(s.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };

  const rows: MontpellierRow[] = [];
  for (const cells of grid.slice(1)) {
    const rooms = /^4/.test(cells[0] ?? "") ? 4 : num(cells[0]);
    const period = (cells[1] ?? "").trim();
    if (rooms === null || !period) continue;
    const values = {
      reference_eur_m2_month: num(cells[2]),
      ceiling_eur_m2_month: num(cells[3]),
      floor_eur_m2_month: num(cells[4]),
    };
    const furnished = {
      reference_eur_m2_month: num(cells[6]),
      ceiling_eur_m2_month: num(cells[7]),
      floor_eur_m2_month: num(cells[8]),
    };
    rows.push({ rooms, period, values, furnished });
  }
  // Montpellier's grid is fixed: 4 room groups × 5 periods = 20 data rows.
  // Anything else is a changed format, not a grid we know how to read.
  return rows.length === 20 ? rows : [];
}

/**
 * Fetch the zone mapping, then the workbook grids, then resolve the query.
 *
 * Two-step resolution, like Lyon: the point's IRIS (carried by the handler)
 * places it in a zone, and that zone's grid holds the reference rents. The
 * consumer gets the reference, ceiling and floor per furnished state.
 */
export async function montpellierRentControl(
  codeIris: string,
  query: RentControlQuery,
): Promise<RentControlResult | null> {
  const zones = await montpellierZoning();
  const zone = zones[codeIris];
  if (zone === undefined) return null;

  const sheets = await montpellierGridSheets();
  const rows = montpellierGridRows(sheets.map((s) => s.cells), zone);
  const picked = pickMontpellierRow(rows, query);
  if (!picked) return null;

  const wanted = query.furnished ?? false;
  const triplet = wanted ? picked.furnished : picked.values;
  const exact =
    (query.rooms === undefined || query.rooms === picked.rooms) &&
    (query.period === undefined || query.period === picked.period) &&
    (query.furnished === undefined || query.furnished === wanted);

  return {
    city: "Montpellier",
    area_label: `Zone ${zone}`,
    year: null,
    rooms: picked.rooms,
    period: picked.period,
    furnished: wanted,
    values: triplet,
    matched: exact ? "exact" : "closest",
    source: RENT_CONTROL_SOURCE,
    source_url: MONTPELLIER_RENT_CONTROL_URL,
    note: RENT_CONTROL_NOTE,
    caveats: CAVEATS,
  };
}

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
  { city: "Montpellier", matches: (code) => parentCommuneCode(code) === "34172" },
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
    // Montpellier keys its zone grid by IRIS, like Lyon.
    if (area.city === "Montpellier" && codeIris) {
      const result = await montpellierRentControl(codeIris, query).catch(() => null);
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

