import { afterEach, describe, expect, it, vi } from "vitest";
import { acquisitionCosts } from "../src/handlers/acquisition.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Mock world with a known price (no DVF needed): BAN for geocoding, the
 * carte-des-loyers CSV, and the OFGL REI tax records.
 *
 * One constant INSEE code is deliberate: the rent table and the REI records
 * are cached in-process for 24 h under the dataset URL, which is the same for
 * every test. Uniqueness comes from the address string, which keys the BAN
 * geocode instead. The "no rent indicator" test below uses a code the table
 * has no line for, which is exactly the situation it must exercise.
 */
function mockWorld(tag: string) {
  const code = "x9001";
  const ban = (props: Record<string, unknown>) => ({
    features: [{ geometry: { coordinates: [4.83, 45.76] }, properties: props }],
  });
  const loyersCsv = [
    "INSEE_C;loypredm2;lwr.IPm2;upr.IPm2;nbobs_com;R2_adj",
    `"${code}";"12,5";"10,0";"14,0";"500";"0,8"`,
  ].join(String.fromCharCode(10));

  const fetchMock = vi.fn(async (rawUrl: string) => {
    const url = decodeURIComponent(String(rawUrl));
    if (url.includes("api-adresse.data.gouv.fr/search")) {
      return jsonResponse(
        ban({
          label: `10 Rue Test ${code} Lyon`,
          id: `${code}_6005_00010`,
          housenumber: "10",
          street: "Rue Test",
          postcode: "69001",
          city: "Lyon",
          citycode: code,
          type: "housenumber",
          score: 0.97,
        }),
      );
    }
    if (url.includes("data.gouv.fr/fr/datasets/r/")) return new Response(loyersCsv);
    if (url.includes("data.ofgl.fr")) {
      // Commune part 500 000 € over 500 taxable articles = 1 000 € average.
      return jsonResponse({
        records: [
          { fields: { idcom: code, annee: 2024, var: "E13", valeur: 500000 } },
          { fields: { idcom: code, annee: 2024, var: "E14", valeur: 500 } },
        ],
      });
    }
    throw new Error(`unexpected URL in acquisition test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

const base = (tag: string) => ({
  address: `10 ${tag} Rue Test Lyon`,
  type_local: "Appartement" as const,
  surface_m2: 50,
});

describe("acquisitionCosts", () => {
  it("computes the statutory 2026 fee scale on a known price", async () => {
    mockWorld("acqalpha");

    const r = await acquisitionCosts({ ...base("acqalpha"), price_eur: 100_000 });

    // 4.50 % base + 0.7163 % department + 1.204 % commune = 6.4203 %
    expect(r.acquisition_costs.base_pct).toBe(4.5);
    expect(r.acquisition_costs.rights_de_mutation_pct).toBeCloseTo(6.4203, 4);
    expect(r.acquisition_costs.droits_de_mutation).toBe(6420);
    // Standard notary card: 750 € per deed + 0.5 h at 100 €/h.
    expect(r.acquisition_costs.emoluments_notaire).toBe(800);
    expect(r.acquisition_costs.publication).toBe(200);
    expect(r.acquisition_costs.total_fees).toBe(7420);

    // 12.5 €/m²/month × 50 m² = 625 €/month, 7 500 €/year.
    expect(r.loyer.eur_m2_month).toBe(12.5);
    expect(r.loyer.eur_month).toBe(625);
    expect(r.loyer.eur_year).toBe(7500);

    // 500 000 € / 500 articles = 1 000 € average annual tax.
    expect(r.taxe_foncière_annuale).toBe(1000);

    // 7 500 / 100 000 = 7.5 % gross; net = (7 500 − 1 000 − 7 420) / 100 000.
    expect(r.returns.gross_yield_pct).toBe(7.5);
    expect(r.returns.net_yield_pct).toBeCloseTo(-0.92, 1);
    expect(r.price_from).toBe("estimate");
  });

  it("honours the asking price and the notary model", async () => {
    mockWorld("acqbeta");

    const r = await acquisitionCosts({
      ...base("acqbeta"),
      price_eur: 200_000,
      price_from: "asking",
      notary_model: "aggressive",
    });

    expect(r.price_eur).toBe(200000);
    expect(r.price_from).toBe("asking");
    expect(r.acquisition_costs.droits_de_mutation).toBe(12841); // 200 000 × 6.4203 %
    expect(r.acquisition_costs.emoluments_notaire).toBe(750); // bare minimum
    expect(r.acquisition_costs.total_fees).toBe(12841 + 750 + 200);
  });

  it("refuses invalid inputs before querying anything", async () => {
    mockWorld("acqgamma");

    await expect(acquisitionCosts({ ...base("acqgamma"), surface_m2: 4 })).rejects.toThrow(/between 8 and 1 000/);
    await expect(acquisitionCosts({ ...base("acqgamma"), type_local: "Garage" as never })).rejects.toThrow(
      /Appartement.*Maison/,
    );
    await expect(acquisitionCosts({ ...base("acqgamma"), notary_model: "rich" as never })).rejects.toThrow(
      /notary_model/,
    );
    await expect(acquisitionCosts({ ...base("acqgamma"), price_from: "free" as never })).rejects.toThrow(
      /price_from/,
    );
  });

  it("fails loudly when no rent indicator covers the address", async () => {
    // The mock rent table has no line for this INSEE code: rentIndicator
    // returns null and the simulator refuses to invent a yield.
    const code = "zz9001";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (rawUrl: string) => {
        const url = decodeURIComponent(String(rawUrl));
        if (url.includes("api-adresse.data.gouv.fr/search")) {
          return jsonResponse({
            features: [
              {
                geometry: { coordinates: [4.83, 45.76] },
                properties: {
                  label: "10 Rue Test Lyon",
                  id: `${code}_6005_00010`,
                  housenumber: "10",
                  street: "Rue Test",
                  postcode: "69001",
                  city: "Lyon",
                  citycode: code,
                  type: "housenumber",
                  score: 0.97,
                },
              },
            ],
          });
        }
        if (url.includes("data.gouv.fr/fr/datasets/r/")) {
          return new Response(["INSEE_C;loypredm2", `"99999";"12,5"`].join("\n"));
        }
        if (url.includes("data.ofgl.fr")) return jsonResponse({ records: [] });
        throw new Error(`unexpected URL in acquisition test: ${url}`);
      }),
    );

    await expect(acquisitionCosts({ ...base("acqdelta"), price_eur: 100_000 })).rejects.toThrow(
      /rent indicator/,
    );
  });
});

