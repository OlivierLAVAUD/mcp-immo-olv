import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderReportMarkdown } from "../src/markdown.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../ui/fixtures/property-report-lyon.json", import.meta.url)), "utf8"),
) as Record<string, any>;

const TODAY = new Date("2026-10-09");

describe("renderReportMarkdown", () => {
  it("renders the recorded Lyon dossier with every present section", () => {
    const md = renderReportMarkdown(fixture, TODAY);

    expect(md.startsWith("# Dossier immobilier — ")).toBe(true);
    expect(md).toContain("Généré le 2026-10-09");
    expect(md).toContain("## Marché (DVF)");
    expect(md).toContain("## Ventes notariées récentes");
    expect(md).toContain("## Loyers (Carte des loyers)");
    expect(md).toContain("## Sources");
    expect(md).toContain("pas un avis de valeur professionnel");
    // The dossier is not a professional appraisal, and the footer says so.
    expect(md).toContain("## Sources");
  });

  it("reports a failed section as unavailable, with its reason", () => {
    const md = renderReportMarkdown(
      {
        resolved_address: "10 rue Inconnue, Lyon",
        market: { error: "Address not found in the Base Adresse Nationale." },
        risks: { available: false, unavailable: { reason: "Géorisques 503", portal_url: "https://www.georisques.gouv.fr" } },
      },
      TODAY,
    );

    expect(md).toContain("> ⚠️ **Section indisponible** — Address not found");
    // An unreachable Géorisques reads as UNKNOWN, never as no risk.
    expect(md).toContain("**Statut INCONNU**");
    expect(md).toContain("georisques.gouv.fr");
  });

  it("renders the DPE table with rental status and energy cost", () => {
    const md = renderReportMarkdown(
      {
        resolved_address: "Test",
        energy_diagnostics: {
          diagnostics: [
            {
              adresse_ban: "12 Avenue Montaigne 75008 Paris",
              etiquette_dpe: "F",
              rental_compliance: {
                energy_label: "F",
                rental_status: "bientot_interdit",
                ban_date: "2028-01-01",
                is_passoire_thermique: true,
              },
              annual_energy_cost: { annual_cost_eur: 8697 },
            },
            { adresse_ban: "45 Avenue George V 75008 Paris", etiquette_dpe: "B" },
          ],
        },
      },
      TODAY,
    );

    expect(md).toContain("## DPE & conformité locative");
    expect(md).toContain("**F**");
    expect(md).toContain("bientot_interdit");
    expect(md).toContain("2028-01-01");
    // fr-FR groups thousands with a no-break space — U+202F on recent ICU,
    // U+00A0 on older Node — so match any space instead of a fixed character.
    expect(md).toMatch(/8[\s\u00a0\u202f]697/);
    // A missing label degrades to inconnu, never to lettable.
    expect(md).toContain("inconnu");
  });

  it("omits sections the dossier does not carry", () => {
    const md = renderReportMarkdown({ resolved_address: "Test" }, TODAY);
    expect(md).not.toContain("## Estimation par comparables");
    expect(md).not.toContain("## IRIS");
    expect(md).toContain("## Sources");
  });
});
