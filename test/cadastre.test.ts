import { describe, expect, it } from "vitest";
import { geometryExtent, flattenPositions, toParcel } from "../src/apis/cadastre.js";

describe("flattenPositions", () => {
  it("walks any GeoJSON nesting depth", () => {
    const multi = [
      [
        [
          [1, 2],
          [3, 4],
        ],
      ],
      [
        [
          [5, 6],
        ],
      ],
    ];
    expect(flattenPositions(multi)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("returns nothing for an empty or malformed geometry", () => {
    expect(flattenPositions([])).toEqual([]);
    expect(flattenPositions(undefined)).toEqual([]);
  });
});

describe("geometryExtent", () => {
  it("computes the bbox and an approximate centre", () => {
    const extent = geometryExtent([
      [
        [
          [4.83, 45.76],
          [4.84, 45.76],
          [4.84, 45.77],
          [4.83, 45.77],
          [4.83, 45.76],
        ],
      ],
    ])!;
    expect(extent.bbox).toEqual([4.83, 45.76, 4.84, 45.77]);
    expect(extent.center.lon).toBeCloseTo(4.834, 3);
    expect(extent.center.lat).toBeCloseTo(45.764, 3);
  });

  it("returns null without coordinates", () => {
    expect(geometryExtent(undefined)).toBeNull();
  });
});

describe("toParcel", () => {
  it("maps the IGN cadastre payload, including a string contenance", () => {
    const parcel = toParcel({
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [4.8357, 45.7639],
              [4.8351, 45.7641],
            ],
          ],
        ],
      },
      properties: {
        idu: "69382000AB0062",
        section: "AB",
        numero: "0062",
        contenance: "2861",
        code_insee: "69123",
        nom_com: "Lyon",
        com_abs: "000",
      },
    });

    expect(parcel.idu).toBe("69382000AB0062");
    expect(parcel.section).toBe("AB");
    expect(parcel.numero).toBe("0062");
    expect(parcel.contenance_m2).toBe(2861); // parsed from the string form
    expect(parcel.code_insee).toBe("69123");
    expect(parcel.commune).toBe("Lyon");
    expect(parcel.bbox).toEqual([4.8351, 45.7639, 4.8357, 45.7641]);
  });

  it("tolerates a feature with no properties", () => {
    const parcel = toParcel({});
    expect(parcel.idu).toBe("");
    expect(parcel.contenance_m2).toBeNull();
    expect(parcel.approx_center).toBeNull();
  });
});