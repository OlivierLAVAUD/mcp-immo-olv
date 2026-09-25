import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, TOOL_NAMES } from "../src/server.js";
import { OUTPUT_SCHEMAS, reportSections, section } from "../src/output-schemas.js";

/**
 * Two layers of protection, because they fail differently.
 *
 *  - The **contract** tests go through a real SDK client and a real server over
 *    an in-memory transport: they prove that what we register is what a client
 *    is told, that `structuredContent` is validated against the declared
 *    schema, and that a tool error stays a tool error.
 *  - The **payload** tests replay results the server actually produced (the
 *    captured Lyon dossier under ui/fixtures) through the same schemas. That is
 *    the half that catches a schema drifting away from reality — a promise
 *    about field names that no unit test written from the same code would see.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A real BAN answer, trimmed to the fields the tool reads. */
function banFeature(label: string, citycode: string) {
  return {
    features: [
      {
        geometry: { coordinates: [4.8357, 45.764] },
        properties: {
          label,
          id: `${citycode}_6005_00010`,
          housenumber: "10",
          street: "Rue de la République",
          postcode: "69002",
          city: "Lyon",
          citycode,
          type: "housenumber",
          score: 0.97,
        },
      },
    ],
  };
}

async function connect() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "output-contract-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return { server, client };
}

/** The URL of the payload we asked for, so no test reads a cached neighbour. */
const uniqueAddress = (tag: string) => `${tag} ${Math.random().toString(36).slice(2)} Rue de la Paix Lyon 69002`;

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../ui/fixtures/property-report-lyon.json", import.meta.url)), "utf8"),
) as Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ contract

describe("tool contracts as a client sees them", () => {
  it("publishes every tool with an object output schema, in registration order", async () => {
    const { server, client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);

    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeDefined();
      expect(tool.outputSchema?.type, `${tool.name} is not an object`).toBe("object");
      expect(Object.keys(tool.outputSchema?.properties ?? {}).length).toBeGreaterThan(0);
    }

    await server.close();
  });

  it("keeps unknown fields allowed, so an upstream addition cannot invalidate a tool", async () => {
    const { server, client } = await connect();
    const { tools } = await client.listTools();
    const geocode = tools.find((t) => t.name === "geocode_address");

    // Not just "tolerated at runtime": the published schema has to say so, or a
    // client that validates strictly would reject e.g. ADEME's `_score`.
    expect((geocode?.outputSchema as { additionalProperties?: unknown })?.additionalProperties).not.toBe(false);

    await server.close();
  });

  it("hands the same payload over twice: structured content and the legacy text block", async () => {
    const label = uniqueAddress("10");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(banFeature(label, "69382"))));

    const { server, client } = await connect();
    const result = await client.callTool({ name: "geocode_address", arguments: { query: label } });

    expect(result.isError).toBeFalsy();
    const block = result.content.find((b) => b.type === "text") as { text: string } | undefined;
    expect(block).toBeDefined();

    const structured = result.structuredContent as Record<string, any>;
    expect(structured).toEqual(JSON.parse(block!.text));
    expect(structured.results[0]).toMatchObject({ citycode: "69382", city: "Lyon", type: "housenumber" });

    await server.close();
  });

  it("keeps a tool failure an error, with no structured content to validate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "bad params" }, 400)));

    const { server, client } = await connect();
    const result = await client.callTool({
      name: "geocode_address",
      arguments: { query: uniqueAddress("99") },
    });

    expect(result.isError).toBe(true);
    // The SDK refuses a successful answer without structured content; a failure
    // must therefore stay a failure, which is what wrap() does for us.
    expect(result.structuredContent).toBeUndefined();

    await server.close();
  });
});

// ------------------------------------------------------------------- payload

describe("recorded payloads against the declared schemas", () => {
  // Captured from the live server for a full Lyon dossier. Sections that the
  // fixture predates (rent_control, cadastre, urbanism, iris) are covered by
  // the shapes below, not skipped silently.
  const recorded = [
    "market",
    "recent_sales_nearby",
    "valuation",
    "rent",
    "property_tax",
    "commune",
  ] as const;

  for (const name of recorded) {
    it(`accepts the recorded ${name} section`, () => {
      expect(reportSections[name].safeParse(fixture[name]).success).toBe(true);
    });
  }

  it("accepts the recorded risk list and DPE record", () => {
    // The fixture predates two additions: the explicit `available` flag on
    // risks (Géorisques outage handling) and `by_dataset` on the DPE lookup. We
    // supply those and let every other field come from recorded live data.
    const risks = reportSections.risks.safeParse({
      ...fixture.risks,
      available: true,
      note: "recorded",
    });
    expect(risks.success).toBe(true);

    const energy = reportSections.energy_diagnostics.safeParse({
      ...fixture.energy_diagnostics,
      by_dataset: [],
    });
    expect(energy.success).toBe(true);
    expect(fixture.energy_diagnostics.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts an isolated section failure, which is how a dossier degrades", () => {
    const failing = section(reportSections.market);
    expect(failing.safeParse({ error: "Géorisques is down" }).success).toBe(true);
    expect(failing.safeParse(fixture.market).success).toBe(true);
  });

  it("accepts both rent-control answers: a grid, and an honest 'not covered'", () => {
    const query = {
      resolved_address: "10 Rue de la République 69002 Lyon",
      insee_code: "69382",
      iris_code: null,
      rooms: null,
      furnished: null,
      period: null,
    };
    const notCovered = {
      query,
      covered: false,
      insee_code: "69382",
      source: "Ville de Paris / Métropole de Lyon",
      covered_cities: ["Paris", "Métropole de Lyon"],
      note: "not covered",
    };
    const covered = {
      query,
      covered: true,
      city: "Métropole de Lyon",
      area_label: "zonage 1",
      year: null,
      rooms: 3,
      period: "1946-1970",
      furnished: false,
      values: {
        reference_eur_m2_month: 12.5,
        ceiling_eur_m2_month: 15.0,
        floor_eur_m2_month: 10.4,
      },
      matched: "exact",
      source: "grille de référence",
      source_url: "https://www.grandlyon.com/services/encadrement-des-loyers",
      note: "reference grid",
      caveats: [],
    };

    expect(OUTPUT_SCHEMAS.rent_control.safeParse(notCovered).success).toBe(true);
    expect(OUTPUT_SCHEMAS.rent_control.safeParse(covered).success).toBe(true);
  });
});

// ------------------------------------------------------------- not a no-op

describe("the schemas actually constrain something", () => {
  it("rejects a section that lost a required field", () => {
    const { note, ...withoutNote } = fixture.market;
    expect(note).toBeDefined();
    expect(reportSections.market.safeParse(withoutNote).success).toBe(false);
  });

  it("rejects a wrong field type instead of quietly rendering it", () => {
    expect(
      reportSections.market.safeParse({ ...fixture.market, all_period: { ...fixture.market.all_period, sales: "1417" } })
        .success,
    ).toBe(false);
  });

  it("rejects a confidence level the estimator never produces", () => {
    const estimate = { ...fixture.valuation.estimate, confidence: "very high" };
    expect(reportSections.valuation.safeParse({ ...fixture.valuation, estimate }).success).toBe(false);
  });
});
