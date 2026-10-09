import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { summarizeRisks } from "../src/risk-summary.js";
import { unavailableRiskReport, type SimplifiedRisks } from "../src/apis/georisques.js";
import { createServer } from "../src/server.js";

function risk(riskName: string, at: string | null = null, inCommune: string | null = null) {
  return { risk: riskName, statusAtAddress: at, statusInCommune: inCommune };
}

function report(over: Partial<SimplifiedRisks> = {}): SimplifiedRisks {
  return {
    available: true,
    address: "10 Rue Test, Lyon",
    commune: "Lyon 69002",
    naturalRisks: [],
    technologicalRisks: [],
    officialReportUrl: "https://www.georisques.gouv.fr/rapport/xyz",
    ...over,
  };
}

function item(summary: ReturnType<typeof summarizeRisks>, key: string) {
  return summary.items.find((i) => i.key === key)!;
}

describe("summarizeRisks", () => {
  it("answers every category, present or not", () => {
    const summary = summarizeRisks({
      risks: report({ naturalRisks: [risk("Inondation", "zone inondable", "faible")] }),
    });

    expect(summary.items.map((i) => i.key)).toEqual(["inondation", "argile", "radon", "icpe", "dpe"]);
    expect(item(summary, "inondation").status).toBe("present");
    expect(item(summary, "inondation").sentence).toContain("signalé");
    expect(item(summary, "argile").status).toBe("absent");
    expect(item(summary, "radon").status).toBe("absent");
    expect(item(summary, "icpe").status).toBe("absent");
    expect(summary.signals_count).toBe(1);
    expect(summary.headline).toContain("inondation");
  });

  it("recognises clay shrink-swell whatever Géorisques calls it", () => {
    const summary = summarizeRisks({
      risks: report({
        naturalRisks: [risk("Mouvement de terrain - Tassements différentiels", "moyen", null)],
        technologicalRisks: [risk("Radon", "catégorie 3", null)],
      }),
    });

    expect(item(summary, "argile").status).toBe("present");
    expect(item(summary, "radon").status).toBe("present");
    expect(summary.signals_count).toBe(2);
  });

  it("reads an unreachable Géorisques as unknown, never as absent", () => {
    const summary = summarizeRisks({ risks: unavailableRiskReport("Géorisques API returned HTTP 503") });

    for (const i of summary.items) {
      expect(i.status, i.key).toBe("unknown");
    }
    expect(summary.headline).toContain("INCONNU");
    expect(summary.other_present_risks).toEqual([]);
  });

  it("names risks outside the summarised categories instead of hiding them", () => {
    const summary = summarizeRisks({
      risks: report({ technologicalRisks: [risk("Installations nucléaires")] }),
    });

    expect(summary.other_present_risks).toContain("Installations nucléaires");
    // The headline covers the summarised categories only; the extra risk is
    // surfaced in other_present_risks, never dropped.
    expect(summary.headline.toLowerCase()).not.toContain("installations nucléaires");
  });

  it("keeps acronyms readable and never repeats the same status twice", () => {
    const summary = summarizeRisks({
      risks: report({
        naturalRisks: [risk("Inondation", "Risque Existant", "Risque Existant")],
        technologicalRisks: [risk("Sites industriels", "Risque non Concerne", null)],
      }),
    });

    // Géorisques echoes the address status for the commune: it is one finding,
    // not two.
    expect(item(summary, "inondation").sentence).toBe("Inondation : signalé (Risque Existant).");
    // The headline is lowercased mid-sentence, but an acronym must survive it.
    expect(summary.headline).toContain("sites industriels (ICPE)");
    expect(summary.headline).not.toContain("icpe");
  });

  it("turns the DPE label into its rental status line", () => {
    const soon = summarizeRisks({
      risks: report(),
      dpe: {
        state: "checked",
        compliance: {
          energy_label: "F",
          rental_status: "bientot_interdit",
          ban_date: "2028-01-01",
          is_passoire_thermique: true,
        },
      },
    });
    expect(item(soon, "dpe").status).toBe("present");
    expect(item(soon, "dpe").sentence).toContain("2028-01-01");

    const ok = summarizeRisks({
      risks: report(),
      dpe: {
        state: "checked",
        compliance: { energy_label: "C", rental_status: "louable", ban_date: null, is_passoire_thermique: false },
      },
    });
    expect(item(ok, "dpe").status).toBe("absent");
  });

  it("marks the DPE explicitly when it was not checked", () => {
    const summary = summarizeRisks({ risks: report(), dpe: { state: "not_checked" } });
    expect(item(summary, "dpe").status).toBe("unknown");
    expect(item(summary, "dpe").sentence).toContain("non vérifié");
  });
});

// ------------------------------------------------- validated through the MCP SDK

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("risk_summary through the MCP server", () => {
  it("answers point-only, matching its declared output schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (rawUrl: string) => {
        const url = decodeURIComponent(String(rawUrl));
        if (url.includes("resultats_rapport_risque")) {
          return jsonResponse({
            adresse: { libelle: "10 Rue Test, Lyon" },
            commune: { libelle: "Lyon", codePostal: "69002" },
            url: "https://www.georisques.gouv.fr/rapport/xyz",
            risquesNaturels: {
              inondation: {
                present: true,
                libelle: "Inondation",
                libelleStatutAdresse: "zone inondable",
                libelleStatutCommune: "faible",
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "risk-summary-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const res = await client.callTool({
      name: "risk_summary",
      arguments: { lat: 45.76, lon: 4.83 },
    });

    // The SDK validates structuredContent against the output schema first.
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.available).toBe(true);
    expect(structured.items).toHaveLength(5);
    expect(structured.items.find((i: any) => i.key === "inondation").status).toBe("present");
    expect(structured.items.find((i: any) => i.key === "dpe").status).toBe("unknown");
    expect(structured.headline).toContain("inondation");

    await server.close();
  });
});
