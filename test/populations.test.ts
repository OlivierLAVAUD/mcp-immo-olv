import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLegalPopulationsForTests,
  parsePopulationsCsv,
  POPULATIONS_YEAR,
} from "../src/apis/populations.js";

const CSV_HEADER =
  "REG;Région;DEP;CODARR;CODCAN;CODCOM;COM;Commune;PMUN;PCAP;PTOT\r\n";
const MONT = "76;Occitanie;34;3;99;172;34172;Montpellier;302454;3289;305743\r\n";
const PARIS1 = "11;Île-de-France;75;1;  ;101;75101;Paris 1er Arrondissement;15919;111;16030\r\n";

beforeEach(() => {
  clearLegalPopulationsForTests();
  delete process.env.IMMO_CACHE_DIR;
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearLegalPopulationsForTests();
});

describe("parsePopulationsCsv", () => {
  it("reads pmun / pcap / ptot keyed by commune code", () => {
    const table = parsePopulationsCsv(CSV_HEADER + MONT);
    expect(table["34172"]).toEqual({ pmun: 302454, pcap: 3289, ptot: 305743 });
  });

  it("keeps a row with a missing figure as null, not dropped", () => {
    const row = "11;IDF;75;1;  ;102;75102;Paris 2e;;;17000\r\n";
    const table = parsePopulationsCsv(CSV_HEADER + row);
    expect(table["75102"]).toEqual({ pmun: null, pcap: null, ptot: 17000 });
  });

  it("skips a line with no commune code", () => {
    const table = parsePopulationsCsv(CSV_HEADER + ";Région;DEP;;;;;NoCommune;1;2;3\r\n");
    expect(Object.keys(table)).toHaveLength(0);
  });

  it("ignores the header row", () => {
    const table = parsePopulationsCsv(CSV_HEADER);
    expect(Object.keys(table)).toHaveLength(0);
  });
});

describe("legal populations millésime", () => {
  it("declares the year the archive is the millésime of", () => {
    expect(POPULATIONS_YEAR).toBe(2021);
  });
});

// The PTOT = PMUN + PCAP identity the published rows respect.
describe("legal figures consistency", () => {
  it("holds for the real Montpellier and Paris rows", () => {
    const table = parsePopulationsCsv(CSV_HEADER + MONT + PARIS1);
    for (const row of Object.values(table)) {
      if (row.pmun !== null && row.pcap !== null && row.ptot !== null) {
        expect(row.pmun + row.pcap).toBe(row.ptot);
      }
    }
  });
});
