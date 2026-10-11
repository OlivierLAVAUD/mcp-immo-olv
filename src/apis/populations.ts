import { readDiskCache, writeDiskCache } from "../util/disk-cache.js";
import { inflateZipEntry, zipCentralDirectory } from "../util/zip.js";

/**
 * INSEE "populations légales" — the official legal population used for
 * electoral and fiscal purposes, split three ways per commune:
 *
 *  - `pmun` population municipale (the headline figure, the one quoted),
 *  - `pcap` population comptée à part (people counted separately: students
 *    living elsewhere, military in barracks, detaines…),
 *  - `ptot` population totale = pmun + pcap.
 *
 * Why this source and not geo.api.gouv.fr: the latter serves a single
 * `population` number (a recensement estimate, not the legal figure) and no
 * PCAP/PTOT split. INSEE publishes the legal figures only as a yearly national
 * archive (a .zip of CSVs, ~35 000 communes), so this module downloads it once,
 * keeps the parsed rows on disk behind IMMO_CACHE_DIR, and hydrates memory from
 * there on later runs — the same L1/L2 pattern as the DVF cache.
 *
 * Honest scope: this adds the legal population *breakdown*, not the demographic
 * trend the roadmap wanted (vacant dwellings, secondary residences). INSEE does
 * not expose those through any anonymous per-commune API, so they stay absent
 * rather than approximated — see the caveats returned with the answer.
 */

/** The yearly national archive: INSEE populations légales, all communes. */
const POPULATIONS_URL =
  "https://static.data.gouv.fr/resources/populations-legales-2021/20240213-095355/ensemble.zip";
/** The CSV inside the archive that carries per-commune figures. */
const POPULATIONS_ENTRY = "donnees_communes.csv";
/** Legal-population year this archive is the millésime of. */
export const POPULATIONS_YEAR = 2021;
/** Rows live a year on disk — a new millésime is published yearly. */
const POPULATIONS_TTL_MS = 365 * 24 * 60 * 60_000;

export interface LegalPopulation {
  pmun: number | null;
  pcap: number | null;
  ptot: number | null;
}

/** code_commune -> legal figures. */
export type PopulationTable = Record<string, LegalPopulation>;

/**
 * Parse `donnees_communes.csv` (semicolon-delimited, CRLF). Columns, by index:
 * 0 REG, 1 Région, 2 DEP, 3 CODARR, 4 CODCAN, 5 CODCOM (commune code *within*
 * the département), 6 COM (the full 5-digit INSEE code — the key), 7 Commune,
 * 8 PMUN, 9 PCAP, 10 PTOT. We key by COM (index 6) and read the three figures
 * at 8/9/10; a row with no COM is skipped, and a malformed figure stays null
 * rather than dropping the row.
 */
export function parsePopulationsCsv(csv: string): PopulationTable {
  const table: PopulationTable = {};
  const lines = csv.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cols = line.split(";");
    const code = cols[6];
    if (!code) continue;
    const num = (s: string | undefined): number | null => {
      if (s === undefined || s.trim() === "") return null;
      const v = Number(s.trim());
      return Number.isFinite(v) ? v : null;
    };
    table[code] = {
      pmun: num(cols[8]),
      pcap: num(cols[9]),
      ptot: num(cols[10]),
    };
  }
  return table;
}

let memoryTable: { at: number; value: PopulationTable } | null = null;

/**
 * The full legal-population table: memory first, then disk, then the network.
 * A fresh download re-parses the archive and spills to disk; the next process
 * reads the file instead of re-downloading 1 MB and re-parsing 35 000 rows.
 */
export async function legalPopulations(): Promise<PopulationTable> {
  if (memoryTable && Date.now() - memoryTable.at < POPULATIONS_TTL_MS) return memoryTable.value;

  const fromDisk = await readDiskCache<PopulationTable>("populations-v1", "communes", POPULATIONS_TTL_MS);
  if (fromDisk !== null) {
    memoryTable = { at: Date.now(), value: fromDisk };
    return fromDisk;
  }

  const res = await fetch(POPULATIONS_URL);
  if (!res.ok) throw new Error(`populations légales download failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const entries = zipCentralDirectory(buffer);
  const entry = entries.get(POPULATIONS_ENTRY);
  if (!entry) throw new Error(`populations légales archive is missing ${POPULATIONS_ENTRY}`);
  const table = parsePopulationsCsv(await inflateZipEntry(buffer, entry));

  memoryTable = { at: Date.now(), value: table };
  void writeDiskCache("populations-v1", "communes", table, POPULATIONS_TTL_MS);
  return table;
}

/**
 * The legal population of one commune, or null when the code is unknown
 * (outside the archive, or a code the millésime predates).
 */
export async function legalPopulationFor(insee: string): Promise<LegalPopulation | null> {
  const table = await legalPopulations();
  return table[insee] ?? null;
}

/** Test-only reset of the in-memory table. */
export function clearLegalPopulationsForTests(): void {
  memoryTable = null;
}
