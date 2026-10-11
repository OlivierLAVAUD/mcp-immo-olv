import { afterEach, describe, expect, it, vi } from "vitest";
import {
  latestPeriodYear,
  lyonTypenameFromUrl,
  montpellierGridRows,
  parisRentControl,
  pickLyonValues,
  pickMontpellierRow,
  pickParisRecord,
  rentControlAtPoint,
  ParisRentRecord,
} from "../src/apis/rent_control.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const parisRows: ParisRentRecord[] = [
  { annee: "2024", piece: 2, epoque: "1946-1970", meuble_txt: "non meublé", ref: 25, min: 17.5, max: 30 },
  { annee: "2025", piece: 2, epoque: "1946-1970", meuble_txt: "non meublé", ref: 27.4, min: 19.2, max: 32.9 },
  { annee: "2025", piece: 2, epoque: "1946-1970", meuble_txt: "meublé", ref: 29.9, min: 20.9, max: 35.9 },
  { annee: "2025", piece: 3, epoque: "1946-1970", meuble_txt: "non meublé", ref: 26.1, min: 18.3, max: 31.3 },
];

describe("pickParisRecord", () => {
  it("prefers the most recent year even when an older row fits too", () => {
    expect(pickParisRecord(parisRows, { rooms: 2, furnished: false })?.annee).toBe("2025");
  });

  it("matches the requested number of rooms", () => {
    expect(pickParisRecord(parisRows, { rooms: 3, furnished: false })?.ref).toBe(26.1);
  });

  it("separates furnished from unfurnished rows", () => {
    expect(pickParisRecord(parisRows, { rooms: 2, furnished: false })?.ref).toBe(27.4);
    expect(pickParisRecord(parisRows, { rooms: 2, furnished: true })?.ref).toBe(29.9);
  });

  it("returns null with no rows", () => {
    expect(pickParisRecord([], {})).toBeNull();
  });
});

const lyonValeurs = {
  "1": {
    "1946-1970": {
      meuble: { loyer_reference: 17.6, loyer_reference_majore: 21.1, loyer_reference_minore: 12.3 },
      "non meuble": { loyer_reference: 15.6, loyer_reference_majore: 18.7, loyer_reference_minore: 10.9 },
    },
  },
  "3": {
    "1946-1970": {
      "non meuble": { loyer_reference: 12.1, loyer_reference_majore: 14.5, loyer_reference_minore: 8.5 },
    },
  },
};

describe("pickLyonValues", () => {
  it("walks rooms -> period -> furnished status", () => {
    const picked = pickLyonValues(lyonValeurs, { rooms: 1, furnished: false })!;
    expect(picked.rooms).toBe(1);
    expect(picked.period).toBe("1946-1970");
    expect(picked.furnished).toBe(false);
    expect(picked.values.reference_eur_m2_month).toBe(15.6);
    expect(picked.values.ceiling_eur_m2_month).toBe(18.7);
    expect(picked.values.floor_eur_m2_month).toBe(10.9);
  });

  it("falls back to the nearest room count available", () => {
    expect(pickLyonValues(lyonValeurs, { rooms: 2 })?.rooms).toBe(1);
  });

  it("returns null without a grid", () => {
    expect(pickLyonValues(undefined, {})).toBeNull();
    expect(pickLyonValues({}, {})).toBeNull();
  });
});

describe("source resolution helpers", () => {
  it("extracts the WFS layer name from a data.gouv resource URL", () => {
    const url =
      "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=metropole-de-lyon:car_care.carencadrmtloyer_2025_2026&outputFormat=geojson";
    expect(lyonTypenameFromUrl(url)).toBe("metropole-de-lyon:car_care.carencadrmtloyer_2025_2026");
    expect(lyonTypenameFromUrl("https://example.test/x")).toBeNull();
  });

  it("reads the latest period year from a dataset title", () => {
    expect(latestPeriodYear("Encadrement des loyers de la Métropole de Lyon 2025-2026")).toBe(2026);
    expect(latestPeriodYear("Encadrement des loyers - référentiel")).toBeNull();
  });
});

describe("Montpellier", () => {
  const HEADER = [
    "Nb pièces",
    "Époque de construction",
    "Loyer réf. non meublé",
    "Loyer réf. majoré",
    "Loyer réf. minoré",
    "Majoration unitaire",
    "Loyer réf. meublé",
    "Loyer réf. majoré meublé",
    "Loyer réf. minoré meublé",
  ];

  /** One zone sheet: header + 4 room groups × 5 construction periods. */
  function zoneGrid(base: number): string[][] {
    const periods = ["Avant 1946", "1946-1970", "1971-1990", "1991-2005", "Après 2005"];
    const rooms = ["1", "2", "3", "4 et plus"];
    const rows = [HEADER];
    let i = 0;
    for (const r of rooms)
      for (const p of periods) {
        const ref = base - i * 0.5;
        rows.push([
          r,
          p,
          String(ref),
          String(ref + 2),
          String(ref - 4),
          String(1),
          String(ref + 1.5),
          String(ref + 3.5),
          String(ref - 2.5),
        ]);
        i++;
      }
    return rows;
  }

  it("parses a zone grid into furnished and unfurnished triplets", () => {
    const rows = montpellierGridRows([zoneGrid(12)], 1);
    expect(rows).toHaveLength(20);
    // First row: 1 piece, Avant 1946.
    expect(rows[0].rooms).toBe(1);
    expect(rows[0].period).toBe("Avant 1946");
    expect(rows[0].values.reference_eur_m2_month).toBe(12);
    expect(rows[0].values.ceiling_eur_m2_month).toBe(14);
    expect(rows[0].values.floor_eur_m2_month).toBe(8);
    expect(rows[0].furnished.reference_eur_m2_month).toBe(13.5);
    // "4 et plus" folds to rooms 4.
    expect(rows[19].rooms).toBe(4);
    expect(rows[19].period).toBe("Après 2005");
  });

  it("refuses a sheet that is not the published grid shape", () => {
    // Wrong header, and a short row count: both must yield an empty grid.
    expect(montpellierGridRows([[["Nb pièces", "bad"]], ["1", "x"]], 1)).toEqual([]);
    expect(montpellierGridRows([zoneGrid(12).slice(0, 5)], 1)).toEqual([]);
    // Out-of-range zone.
    expect(montpellierGridRows([zoneGrid(12)], 9)).toEqual([]);
  });

  it("picks the closest room count, then the requested period", () => {
    const rows = montpellierGridRows([zoneGrid(12)], 1);
    const picked = pickMontpellierRow(rows, { rooms: 3, period: "1946-1970" })!;
    expect(picked.rooms).toBe(3);
    expect(picked.period).toBe("1946-1970");
    // No period given: deterministic closest-period fallback.
    expect(pickMontpellierRow(rows, { rooms: 2 })!.rooms).toBe(2);
  });

  it("resolves a Montpellier IRIS through the registry and degrades gracefully", async () => {
    // A Montpellier point (INSEE 34172). The zoning knows the IRIS; the workbook
    // stub is not a real .xlsx, so the grid read throws and the adapter reports
    // "not covered" rather than inventing a ceiling — the same graceful path a
    // real Overpass/ADEME outage takes elsewhere.
    const zoning = { features: [{ properties: { code_iris: "341722501", zone_oll: 3 } }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("MMM_MTP_Loyers.json")
          ? jsonResponse(zoning)
          : new Response("not a zip", { status: 200 }),
      ),
    );

    const outcome = await rentControlAtPoint(43.6, 3.88, "34172", { rooms: 2, period: "1946-1970" }, "341722501");
    expect(outcome.covered).toBe(false);
  });

  it("lists Montpellier among the covered cities", async () => {
    const outcome = await rentControlAtPoint(43.6045, 1.4442, "31555", {});
    expect(outcome.covered).toBe(false);
    if (!outcome.covered) {
      expect(outcome.covered_cities).toContain("Paris");
      expect(outcome.covered_cities).toContain("Métropole de Lyon");
      expect(outcome.covered_cities).toContain("Montpellier");
    }
  });
});

describe("rentControlAtPoint registry", () => {
  it("answers 'not covered' for a commune outside the registry, without network", async () => {
    const outcome = await rentControlAtPoint(43.6045, 1.4442, "31555", {});
    expect(outcome.covered).toBe(false);
    if (!outcome.covered) {
      expect(outcome.covered_cities).toContain("Paris");
      expect(outcome.insee_code).toBe("31555");
    }
  });
});

describe("parisRentControl (stubbed network)", () => {
  it("queries the grid geometrically and maps reference, ceiling and floor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              annee: "2025",
              piece: 2,
              epoque: "1946-1970",
              meuble_txt: "non meublé",
              ref: 27.4,
              min: 19.2,
              max: 32.9,
              nom_quartier: "Porte-Saint-Denis",
              code_grand_quartier: 7511038,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = (await parisRentControl(48.8736176, 2.3522829, {
      rooms: 2,
      furnished: false,
    }))!;

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain("intersects(geo_shape");
    // URLSearchParams encodes the geometry's space as "+", which the API reads
    // back as a space; the literal is (lon lat), in that order.
    expect(url).toContain("POINT(2.3522829+48.8736176)");
    expect(result.city).toBe("Paris");
    expect(result.area_label).toBe("Porte-Saint-Denis");
    expect(result.year).toBe("2025");
    expect(result.matched).toBe("exact");
    expect(result.values).toEqual({
      reference_eur_m2_month: 27.4,
      ceiling_eur_m2_month: 32.9,
      floor_eur_m2_month: 19.2,
    });
  });

  it("returns null when no reference row covers the point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    expect(await parisRentControl(43.6, 1.44, {})).toBeNull();
  });
});