import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearParsedDvfCacheForTests, fetchCommuneYear } from "../src/apis/dvf.js";

const CSV = [
  "id_mutation,date_mutation,nature_mutation,valeur_fonciere,adresse_numero,adresse_nom_voie,code_postal,code_commune,nom_commune,type_local,surface_reelle_bati,nombre_pieces_principales,surface_terrain,longitude,latitude",
  "m1,2024-01-01,Vente,100000,1,RUE TEST,01000,01001,Test,Maison,50,3,,5.1,46.2",
].join("\n");

beforeEach(() => clearParsedDvfCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  clearParsedDvfCacheForTests();
});

describe("parsed DVF commune/year cache", () => {
  it("coalesces concurrent parsing and serves later calls from parsed rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(CSV, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second, third] = await Promise.all([
      fetchCommuneYear("01001", 2024),
      fetchCommuneYear("01001", 2024),
      fetchCommuneYear("01001", 2024),
    ]);
    const later = await fetchCommuneYear("01001", 2024);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second[0].idMutation).toBe("m1");
    expect(third[0].idMutation).toBe("m1");
    expect(later[0].idMutation).toBe("m1");
  });
});
