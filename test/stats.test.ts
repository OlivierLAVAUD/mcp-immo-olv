import { describe, expect, it } from "vitest";
import { mean, median, quantile, round } from "../src/util/stats.js";

describe("stats", () => {
  it("median of odd/even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("mean", () => {
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBeNull();
  });

  it("quantile", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([10], 0.75)).toBe(10);
    expect(quantile([], 0.5)).toBeNull();
  });

  it("round", () => {
    expect(round(1234.567, 0)).toBe(1235);
    expect(round(1.005, 1)).toBe(1);
    expect(round(null)).toBeNull();
  });
});
