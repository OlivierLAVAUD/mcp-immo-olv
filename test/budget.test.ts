import { afterEach, describe, expect, it, vi } from "vitest";
import { searchByBudget } from "../src/handlers/budget.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

const DVF_COLUMNS =
  "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude";

/**
 * A 4-commune département: two affordable, one too dear for the budget
 * (excluded for surface), one too small to be scanned (population floor).
 * One constant table per test file, since the loyers table is cached in-process.
 */
const COMMUNES = [
  { nom: "Ville A", code: "69001", population: 50000, codesPostaux: ["69001"] },
  { nom: "Ville B", code: "69002", population: 20000, codesPostaux: ["69002"] },
  { nom: "Ville C", code: "69003", population: 30000, codesPostaux: ["69003"] },
  { nom: "Village D", code: "69004", population: 100, codesPostaux: ["69004"] },
];

/** price per commune, €/m²; absent code = no sale that year. */
function saleRow(id: string, year: number, priceM2: number, code: string): string {
  const price = priceM2 * 50;
  return `${id},${year}-03-01,1,Vente,${price},10,,RUE TEST,6998,69001,${code},Lyon 1er,69,,,69001100AB0001,,,,,,,,,,,,,1,2,Appartement,50,3,,,,,,4.83,45.76`;
}

function mockWorld(rents: Record<string, number>) {
  const loyersCsv = [
    "INSEE_C;loypredm2;lwr.IPm2;upr.IPm2;nbobs_com;R2_adj",
    ...Object.entries(rents).map(([code, r]) => `"${code}";"${String(r).replace(".", ",")},0";"10,0";"14,0";"500";"0,8"`),
  ].join(String.fromCharCode(10));

  const fetchMock = vi.fn(async (rawUrl: string) => {
    const url = decodeURIComponent(String(rawUrl));
    if (url.includes("geo.api.gouv.fr/communes?codeDepartement")) {
      return jsonResponse(COMMUNES);
    }
    if (url.includes("geo-dvf")) {
      const year = Number(url.split("/csv/")[1]?.split("/")[0]) || 2026;
      // The real endpoint serves one CSV per commune: only the rows of the
      // commune in the URL. (code_postal stays 69001 for all of them.)
      const insee = url.split("/communes/")[1]?.split("/")[1]?.split(".csv")[0];
      const byCommune: Record<string, number[]> = {
        "69001": [5000, 5000, 5000],
        "69002": [8000, 8000, 8000],
        "69003": [15000, 15000, 15000],
      };
      const prices = byCommune[insee ?? ""] ?? [];
      const rows = prices.map((p, i) => saleRow(`${insee}-${i}-${year}`, year, p, insee!));
      return new Response([DVF_COLUMNS, ...rows].join("\n"));
    }
    if (url.includes("data.gouv.fr/fr/datasets/r/")) return new Response(loyersCsv);
    throw new Error(`unexpected URL in budget test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("searchByBudget", () => {
  it("inverts the market: budget ÷ median €/m² = surface, per commune", async () => {
    mockWorld({ "69001": 15, "69002": 12 });

    const r = await searchByBudget({
      budget_eur: 300_000,
      type_local: "Appartement",
      zone: "69",
      min_surface_m2: 30,
    });

    expect(r.zone.departement).toBe("69");
    // Ville D (population 100) is below the floor and never scanned.
    expect(r.zone.communes_scanned).toBe(3);
    expect(r.communes).toHaveLength(2);

    const [a, b] = r.communes;
    expect(a.insee_code).toBe("69001");
    expect(a.price.median_eur_m2_last_12m).toBe(5000);
    expect(a.surface.max_surface_m2).toBe(60); // 300 000 / 5 000
    expect(b.surface.max_surface_m2).toBe(37); // 300 000 / 8 000

    // Ville C: 20 m² < the 30 m² minimum → excluded, recorded as data-thin.
    expect(r.communes.map((c) => c.insee_code)).not.toContain("69003");
    expect(r.not_enough_data.map((c) => c.insee_code)).toContain("69003");

    // Rankings: most surface first, then best yield (15 × 60 vs 12 × 37).
    expect(r.rankings.most_surface).toEqual([0, 1]);
    expect(r.rankings.cheapest_eur_m2).toEqual([0, 1]);
    expect(r.rankings.best_gross_yield_pct[0]).toBe(0);
  });

  it("refuses invalid inputs", async () => {
    mockWorld({ "69001": 15 });

    await expect(searchByBudget({ budget_eur: 0, zone: "69" })).rejects.toThrow(/positive/);
    await expect(searchByBudget({ budget_eur: 100_000, zone: "" })).rejects.toThrow(/zone is required/);
  });
});
