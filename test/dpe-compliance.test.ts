import { describe, expect, it } from "vitest";
import {
  annualEnergyCost,
  DEFAULT_ENERGY_PRICE_EUR_KWH,
  rentalCompliance,
} from "../src/dpe-compliance.js";

describe("rentalCompliance", () => {
  it("bans G and H since 2025-01-01 (décret n° 2024-501)", () => {
    const today = new Date("2026-10-09");
    for (const label of ["G", "H"]) {
      const c = rentalCompliance(label, today);
      expect(c.rental_status).toBe("interdit");
      expect(c.ban_date).toBe("2025-01-01");
      expect(c.is_passoire_thermique).toBe(true);
    }
  });

  it("keeps F lettable until 2028-01-01, then bans it", () => {
    expect(rentalCompliance("F", new Date("2026-10-09")).rental_status).toBe("bientot_interdit");
    expect(rentalCompliance("F", new Date("2026-10-09")).ban_date).toBe("2028-01-01");
    expect(rentalCompliance("F", new Date("2028-01-01")).rental_status).toBe("interdit");
    // The ban bites on the day itself, not the day after.
    expect(rentalCompliance("F", new Date("2027-12-31")).rental_status).toBe("bientot_interdit");
  });

  it("dates E's ban at 2034-01-01 without calling it a passoire", () => {
    const c = rentalCompliance("E", new Date("2026-10-09"));
    expect(c.rental_status).toBe("bientot_interdit");
    expect(c.ban_date).toBe("2034-01-01");
    expect(c.is_passoire_thermique).toBe(false);
  });

  it("treats A–D as lettable with no dated ban", () => {
    for (const label of ["A", "B", "C", "D"]) {
      const c = rentalCompliance(label);
      expect(c.rental_status).toBe("louable");
      expect(c.ban_date).toBeNull();
      expect(c.is_passoire_thermique).toBe(false);
    }
  });

  it("reports an unreadable label as inconnu, never as lettable", () => {
    for (const label of [null, undefined, "", "Z", "AA"]) {
      expect(rentalCompliance(label).rental_status).toBe("inconnu");
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(rentalCompliance(" f ").energy_label).toBe("F");
    expect(rentalCompliance("g").rental_status).toBe("interdit");
  });
});

describe("annualEnergyCost", () => {
  it("monetises the DPE figure at the default tariff", () => {
    const cost = annualEnergyCost(120, 50);
    expect(cost).toEqual({
      conso_kwh_year: 6000,
      energy_price_eur_kwh: DEFAULT_ENERGY_PRICE_EUR_KWH,
      annual_cost_eur: Math.round(6000 * DEFAULT_ENERGY_PRICE_EUR_KWH),
    });
  });

  it("honours an explicit tariff", () => {
    expect(annualEnergyCost(100, 10, 0.3)?.annual_cost_eur).toBe(300);
  });

  it("refuses to invent a figure when the diagnostic is incomplete", () => {
    expect(annualEnergyCost(undefined, 50)).toBeNull();
    expect(annualEnergyCost(120, undefined)).toBeNull();
    expect(annualEnergyCost(null, null)).toBeNull();
    expect(annualEnergyCost(120, 0)).toBeNull();
    expect(annualEnergyCost(-5, 50)).toBeNull();
    expect(annualEnergyCost(120, 50, 0)).toBeNull();
  });
});
