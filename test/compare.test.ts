import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRankings, compareProperties, type CompareRow } from "../src/handlers/compare.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ------------------------------------------------------------------ pure part

function row(price: number | null, yieldPct: number | null): CompareRow {
  return {
    input: { address: "x", type_local: null, surface_m2: null, rooms: null },
    resolved_address: null,
    market: { median_eur_m2_last_12m: price, sales_last_12m: 5, median_eur_m2_all_period: price },
    valuation:
      yieldPct === null
        ? null
        : {
            value_eur: { estimate: 200000, low: 180000, high: 220000 },
            confidence: "medium",
            comps_used: 12,
            effective_sample_size: 8,
            gross_yield_pct: yieldPct,
            net_yield_after_average_property_tax_pct: null,
          },
    rent: null,
    energy: null,
    errors: {},
  };
}

describe("buildRankings", () => {
  it("orders rows by price ascending and yield descending, as indices", () => {
    const rows = [row(6000, 3.1), row(4000, 4.2), row(5000, null)];
    const rankings = buildRankings(rows);
    expect(rankings.cheapest_eur_m2).toEqual([1, 2, 0]);
    // Rows without a yield figure are absent from the yield ranking — never
    // ranked last, which would read as "worst" instead of "unknown".
    expect(rankings.best_gross_yield_pct).toEqual([1, 0]);
  });

  it("leaves a ranking empty when no row has the figure", () => {
    expect(buildRankings([row(null, null)])).toEqual({ cheapest_eur_m2: [], best_gross_yield_pct: [] });
  });
});

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------- handler composition

const DVF_COLUMNS =
  "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude";

/**
 * One fictional commune, two sale clusters 2.3 km apart: identical DVF and
 * loyers URLs per mock world (cache-safe: the ParsedDvfCache key joins the
 * commune and year, so every test reads its own CSV), while the 400 m radius
 * keeps each target's market on its own cluster. BAN and DPE answer per
 * query, so each test also uses a fresh address tag and never reads a
 * neighbour's cache.
 */
function mockWorld(tag: string) {
  // One letter per tag keeps commune codes legal yet unique ("a9001").
  const code = `${tag.slice(-2, -1)}9001`;
  const ban = (props: Record<string, unknown>, lon: number, lat: number) => ({
    features: [{ geometry: { coordinates: [lon, lat] }, properties: props }],
  });
  const base = {
    housenumber: "10",
    street: "Rue Test",
    postcode: "69001",
    city: "Lyon",
    citycode: code,
    type: "housenumber",
    score: 0.97,
  };
  const sale = (id: string, year: number, price: number, lon: number, lat: number) =>
    `${id},${year}-03-01,1,Vente,${price},10,,RUE TEST,6998,69001,${code},Lyon 1er,69,,,69001100AB0001,,,,,,,,,,,,,1,2,Appartement,50,3,,,,,,${lon},${lat}`;
  const loyersCsv =
    `INSEE_C;loypredm2;lwr.IPm2;upr.IPm2;nbobs_com;R2_adj\n"69001";"12,5";"10,0";"14,0";"500";"0,8"\n`;
  const loyersCsvFixed = [
    "INSEE_C;loypredm2;lwr.IPm2;upr.IPm2;nbobs_com;R2_adj",
    `"${code}";"12,5";"10,0";"14,0";"500";"0,8"`,
  ].join(String.fromCharCode(10));
  const dpe = (label: string) => ({
    total: 1,
    results: [
      {
        adresse_ban: "10 Rue Test 69001 Lyon",
        etiquette_dpe: label,
        surface_habitable_logement: 50,
        date_etablissement_dpe: "2023-06-01",
        conso_5_usages_par_m2_ep: 160,
      },
    ],
  });

  const fetchMock = vi.fn(async (rawUrl: string) => {
    const url = decodeURIComponent(String(rawUrl));
    if (url.includes("api-adresse.data.gouv.fr/search")) {
      if (url.includes(`${tag}nowhere`)) return jsonResponse({ features: [] });
      if (url.includes(`${tag}b`)) {
        return jsonResponse(
          ban({ ...base, label: "20 Rue Test 69001 Lyon", id: `${code}_7001_00020` }, 4.86, 45.76),
        );
      }
      return jsonResponse(ban({ ...base, label: "10 Rue Test 69001 Lyon", id: `${code}_6005_00010` }, 4.83, 45.76));
    }
    // One CSV for every commune/year: the radius filter splits the clusters.
    // The sale year joins the mutation id, which must stay unique across the
    // commune files that groupMutations merges.
    if (url.includes("geo-dvf")) {
      const year = Number(url.split("/csv/")[1]?.split("/")[0]) || 2026;
      const rows = [
        sale(`${tag}a0-${year}`, year, 200000, 4.83, 45.76),
        sale(`${tag}a1-${year}`, year, 210000, 4.83, 45.76),
        sale(`${tag}a2-${year}`, year, 220000, 4.83, 45.76),
        sale(`${tag}b0-${year}`, year, 400000, 4.86, 45.76),
        sale(`${tag}b1-${year}`, year, 410000, 4.86, 45.76),
        sale(`${tag}b2-${year}`, year, 420000, 4.86, 45.76),
      ];
      return new Response([DVF_COLUMNS, ...rows].join("\n"));
    }
    if (url.includes("geo.api.gouv.fr/communes?lat=")) {
      // communesAround probes 8 points at the radius for every section of
      // every target: all probes land on the single mock commune.
      return jsonResponse([{ code }]);
    }
    if (url.includes("data.gouv.fr/fr/datasets/r/")) return new Response(loyersCsvFixed);
    if (url.includes("data.ofgl.fr")) {
      return jsonResponse({
        records: [
          { fields: { idcom: code, annee: 2024, var: "E13", valeur: 500000 } },
          { fields: { idcom: code, annee: 2024, var: "E14", valeur: 500 } },
        ],
      });
    }
    if (url.includes("data.ademe.fr")) {
      if (url.includes(`${code}_6005`)) return jsonResponse(dpe("F"));
      if (url.includes(`${code}_7001`)) return jsonResponse({ total: 0, results: [] });
      return jsonResponse(dpe("C")); // address-search fallback
    }
    throw new Error(`unexpected URL in compare test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("compareProperties handler", () => {
  it("compares two targets and ranks the cheaper market first", async () => {
    mockWorld("zetaalpha");

    const result = await compareProperties({
      targets: [
        { address: "10 zetaalpha Rue Test Lyon", type_local: "Appartement", surface_m2: 50 },
        { address: "10 zetaalphab Rue Test Lyon", type_local: "Appartement", surface_m2: 50 },
      ],
      radius_m: 400,
    });

    expect(result.query.targets_count).toBe(2);
    expect(result.rows).toHaveLength(2);

    // The 400 m radius keeps each target on its own sale cluster: 200k/50 m²
    // around target 0, 400k/50 m² around target 1.
    const [rowA, rowB] = result.rows;
    expect(rowA.resolved_address).toContain("10 Rue Test");
    expect(rowB.resolved_address).toContain("20 Rue Test");
    expect(rowA.market?.median_eur_m2_last_12m).toBe(4200);
    expect(rowB.market?.median_eur_m2_last_12m).toBe(8200);
    expect(result.rankings.cheapest_eur_m2).toEqual([0, 1]);

    // The BAN id routes DPE: target A's register holds an F label.
    expect(rowA.energy?.energy_label).toBe("F");
    expect(rowA.energy?.rental_status).toBe("bientot_interdit");
    expect(rowA.energy?.ban_date).toBe("2028-01-01");
    expect(rowA.energy?.annual_energy_cost_eur).toBe(2050);
    expect(rowB.energy?.energy_label).toBe("C");
    expect(rowB.energy?.rental_status).toBe("louable");

    // Rents and the valuation yield flow into the rows.
    expect(rowA.rent?.rent_eur_m2_month).toBe(12.5);
    expect(rowA.rent?.estimated_monthly_rent_eur).toBe(625);
    expect(rowA.valuation?.confidence).toBeDefined();
    expect(rowA.valuation?.gross_yield_pct).not.toBeNull();

    expect(rowA.errors).toEqual({});
    expect(rowB.errors).toEqual({});
  });

  it("degrades a dead address without killing the comparison", async () => {
    mockWorld("zetabeta");

    const result = await compareProperties({
      targets: [{ address: "10 zetabeta Rue Test Lyon" }, { address: "10 zetabetanowhere Rue Nowhere" }],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].market?.median_eur_m2_last_12m).toBe(4200);
    // BAN returns no candidates → every section of that row records an error.
    expect(result.rows[1].errors.market).toMatch(/Address not found/);
    expect(result.rows[1].market).toBeNull();
    // Rankings treat an unresolvable market as unknown — absent, not last.
    expect(result.rankings.cheapest_eur_m2).toEqual([0]);
  });

  it("needs at least two targets", async () => {
    await expect(compareProperties({ targets: [{ address: "Lyon" }] })).rejects.toThrow(/at least 2 targets/);
  });
});

