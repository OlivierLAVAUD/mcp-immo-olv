import { describe, expect, it } from "vitest";
import {
  toMultiPolygon,
  pointInMultiPolygon,
  pointInPolygon,
  pointInRing,
  toIrisArea,
} from "../src/apis/iris.js";

const square: [number, number][][] = [
  [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
    [0, 0],
  ],
];

describe("point in polygon", () => {
  it("detects a point inside and outside a ring", () => {
    expect(pointInRing(2, 2, square[0])).toBe(true);
    expect(pointInRing(5, 2, square[0])).toBe(false);
    expect(pointInPolygon(2, 2, square)).toBe(true);
    expect(pointInPolygon(-1, 2, square)).toBe(false);
  });

  it("excludes points falling in a hole", () => {
    const withHole: [number, number][][] = [
      square[0],
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ],
    ];
    expect(pointInPolygon(0.5, 0.5, withHole)).toBe(true);
    expect(pointInPolygon(2, 2, withHole)).toBe(false); // inside the hole
  });

  it("handles a multipolygon made of two islands", () => {
    const multi = [
      square,
      [
        [
          [10, 10],
          [12, 10],
          [12, 12],
          [10, 12],
          [10, 10],
        ],
      ],
    ];
    expect(pointInMultiPolygon(11, 11, multi)).toBe(true);
    expect(pointInMultiPolygon(2, 2, multi)).toBe(true);
    expect(pointInMultiPolygon(6, 6, multi)).toBe(false);
  });

  it("returns false for an empty geometry", () => {
    expect(pointInPolygon(1, 1, [])).toBe(false);
    expect(pointInMultiPolygon(1, 1, [])).toBe(false);
  });
});

describe("toMultiPolygon", () => {
  it("wraps a Polygon and passes a MultiPolygon through", () => {
    expect(toMultiPolygon({ type: "Polygon", coordinates: square })).toHaveLength(1);
    expect(toMultiPolygon({ type: "MultiPolygon", coordinates: [square] })).toHaveLength(1);
    expect(toMultiPolygon(null)).toEqual([]);
    expect(toMultiPolygon({ type: "Point", coordinates: [1, 2] })).toEqual([]);
  });
});

describe("toIrisArea", () => {
  it("maps the ADMINEXPRESS attributes", () => {
    const area = toIrisArea(
      {
        code_iris: "693830101",
        nom_iris: "Centre",
        type_iris: "H",
        code_insee: "69383",
        nom_commune: "Lyon 3e Arrondissement",
      },
      "69383",
    );
    expect(area.code_iris).toBe("693830101");
    expect(area.name).toBe("Centre");
    expect(area.type).toBe("H");
    expect(area.commune).toBe("Lyon 3e Arrondissement");
  });

  it("falls back to the query commune and keeps unknown values null", () => {
    const area = toIrisArea({}, "69123");
    expect(area.code_iris).toBe("");
    expect(area.name).toBeNull();
    expect(area.code_insee).toBe("69123");
  });
});