import { describe, expect, it } from "vitest";
import { summarizePropertyTax } from "../src/apis/taxes.js";

function row(varCode: string, value: number, year = 2025) {
  return { fields: { annee: String(year), var: varCode, valeur: value } };
}

describe("summarizePropertyTax", () => {
  it("sums the published average tax components per taxable article", () => {
    const estimate = summarizePropertyTax("69123", [
      row("E13", 1_000),
      row("E14", 100),
      row("E33", 100),
      row("E23", 50),
      row("E53gGEMAPI", 20),
      row("E54gGEMAPI", 100),
      row("F13", 300),
      row("F14", 100),
    ]);

    expect(estimate).not.toBeNull();
    expect(estimate?.year).toBe(2025);
    // 10 (commune) + 1 (GFP) + 0.5 (syndicates) + 0.2 (GEMAPI) + 3 (TEOM), rounded once.
    expect(estimate?.typical_annual_charge_eur).toBe(15);
    expect(estimate?.coverage).toBe("complete");
    expect(estimate?.components[0]).toMatchObject({
      code: "commune",
      amount_eur: 1000,
      taxable_articles: 100,
      average_charge_eur: 10,
    });
  });

  it("returns an explicit partial estimate when optional levies are not published", () => {
    const estimate = summarizePropertyTax("33063", [row("E13", 2_000), row("E14", 100)]);

    expect(estimate?.typical_annual_charge_eur).toBe(20);
    expect(estimate?.coverage).toBe("partial");
    expect(estimate?.components.find((c) => c.code === "teom")?.average_charge_eur).toBeNull();
  });

  it("uses the newest year when no vintage is specified", () => {
    const estimate = summarizePropertyTax("75056", [
      row("E13", 500, 2024),
      row("E14", 100, 2024),
      row("E13", 900, 2025),
      row("E14", 100, 2025),
    ]);

    expect(estimate?.year).toBe(2025);
    expect(estimate?.typical_annual_charge_eur).toBe(9);
  });

  it("does not invent a charge without the communal amount and denominator", () => {
    expect(summarizePropertyTax("75056", [row("E13", 500)])).toBeNull();
    expect(summarizePropertyTax("75056", [row("E14", 100)])).toBeNull();
  });
});
