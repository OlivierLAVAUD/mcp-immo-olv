import { describe, expect, it } from "vitest";
import { groupMutations, rowsFromCsv, withinRadius } from "../src/apis/dvf.js";

const HEADER =
  "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

// id,date,nature,price,numero,voie,commune,type_local,surface,pieces,lon,lat
function saleRow(opts: {
  id: string;
  price: string;
  type: string;
  surface: string;
  date?: string;
  lon?: string;
  lat?: string;
}): string {
  const { id, price, type, surface, date = "2024-03-01", lon = "2.33", lat = "48.86" } = opts;
  return `${id},${date},1,Vente,${price},10,,RUE DE LA PAIX,6998,75002,75102,Paris 2e Arrondissement,75,,,750102000AB0001,,,,,,,,,,,,,1,2,${type},${surface},3,,,,,,${lon},${lat}`;
}

describe("rowsFromCsv + groupMutations", () => {
  it("computes price per m² for a single-dwelling sale", () => {
    const rows = rowsFromCsv(csv([saleRow({ id: "m1", price: "500000", type: "Appartement", surface: "50" })]));
    const [m] = groupMutations(rows);
    expect(m.price).toBe(500000);
    expect(m.dwellings).toHaveLength(1);
    expect(m.priceM2).toBe(10000);
  });

  it("does not compute price per m² when a deed bundles several dwellings", () => {
    const rows = rowsFromCsv(
      csv([
        saleRow({ id: "m1", price: "900000", type: "Appartement", surface: "50" }),
        saleRow({ id: "m1", price: "900000", type: "Appartement", surface: "40" }),
      ]),
    );
    const mutations = groupMutations(rows);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].dwellings).toHaveLength(2);
    expect(mutations[0].priceM2).toBeNull();
  });

  it("keeps dependencies out of dwellings but lists them", () => {
    const rows = rowsFromCsv(
      csv([
        saleRow({ id: "m1", price: "300000", type: "Appartement", surface: "45" }),
        saleRow({ id: "m1", price: "300000", type: "Dépendance", surface: "" }),
      ]),
    );
    const [m] = groupMutations(rows);
    expect(m.dwellings).toHaveLength(1);
    expect(m.otherLocals).toEqual(["Dépendance"]);
    expect(m.priceM2).toBeCloseTo(300000 / 45, 5);
  });

  it("sorts mutations by date, most recent first", () => {
    const rows = rowsFromCsv(
      csv([
        saleRow({ id: "old", price: "100000", type: "Maison", surface: "80", date: "2022-01-15" }),
        saleRow({ id: "new", price: "200000", type: "Maison", surface: "80", date: "2025-06-30" }),
      ]),
    );
    const mutations = groupMutations(rows);
    expect(mutations.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("filters by radius", () => {
    const rows = rowsFromCsv(
      csv([
        saleRow({ id: "near", price: "100000", type: "Maison", surface: "80", lon: "2.3300", lat: "48.8600" }),
        saleRow({ id: "far", price: "100000", type: "Maison", surface: "80", lon: "2.4300", lat: "48.9600" }),
      ]),
    );
    const mutations = groupMutations(rows);
    const near = mutations.filter((m) => withinRadius(m, 48.86, 2.33, 500));
    expect(near.map((m) => m.id)).toEqual(["near"]);
  });
});
