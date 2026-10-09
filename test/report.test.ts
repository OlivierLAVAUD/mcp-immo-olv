import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { propertyReport } from "../src/handlers/report.js";
import { createServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function banFeature(label: string) {
  return {
    features: [
      {
        geometry: { coordinates: [4.8357, 45.764] },
        properties: {
          label,
          id: "69382_6005_00010",
          housenumber: "10",
          street: "Rue Test",
          postcode: "69002",
          city: "Lyon",
          citycode: "69382",
          type: "housenumber",
          score: 0.97,
        },
      },
    ],
  };
}

/**
 * Only the Base Adresse Nationale answers; every other upstream 404s.
 *
 * That is enough to exercise the batch logic for real: geocoding decides
 * whether an address becomes a dossier, and every other section degrades to
 * `{ error }` exactly as it would on a live outage — so the test proves the
 * batch isolates failures without needing a dozen API mocks.
 */
function mockBanOnly() {
  const fetchMock = vi.fn(async (rawUrl: string) => {
    const url = decodeURIComponent(String(rawUrl));
    if (url.includes("api-adresse.data.gouv.fr/search")) {
      if (url.includes("nowhere")) return jsonResponse({ features: [] });
      const label = decodeURIComponent(url.match(/[?&]q=([^&]+)/)?.[1] ?? "10 Rue Test Lyon");
      return jsonResponse(banFeature(label));
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------- argument handling

describe("propertyReport arguments", () => {
  it("needs either one address or a 2–5 address batch", async () => {
    await expect(propertyReport({})).rejects.toThrow(/needs an `address`/);
    await expect(propertyReport({ address: "a", addresses: ["a", "b"] })).rejects.toThrow(/not both/);
    await expect(propertyReport({ addresses: ["a"] })).rejects.toThrow(/2 to 5/);
    await expect(propertyReport({ addresses: Array(6).fill("x") })).rejects.toThrow(/2 to 5/);
  });
});

// ------------------------------------------------------------------ batch form

describe("propertyReport batch form", () => {
  it("isolates an unresolvable address without killing the batch", async () => {
    mockBanOnly();

    const result: any = await propertyReport({
      addresses: ["10 Rue Test Lyon", "10 nowhere Rue Test Lyon"],
    });

    expect(result.query.addresses_count).toBe(2);
    expect(result.reports).toHaveLength(2);

    const [ok, dead] = result.reports;
    expect(ok.input_address).toBe("10 Rue Test Lyon");
    expect(ok.resolved_address).toContain("Rue Test");
    // The DVF section treats the unmocked 404 as "no sales" (empty market),
    // so the section succeeds rather than erroring.
    expect(ok.market).not.toHaveProperty("error");
    expect(ok.market.query.resolved_address).toContain("Rue Test");
    // Upstreams that genuinely fail degrade to a per-section `{ error }` — they
    // never sink the dossier, exactly as in the single-address form.
    const degraded = Object.values(ok).filter(
      (v) => v && typeof v === "object" && "error" in (v as object),
    );
    expect(degraded.length).toBeGreaterThan(0);

    // The dead address carries its own error and no dossier; the good one is
    // untouched by it.
    expect(dead.input_address).toBe("10 nowhere Rue Test Lyon");
    expect(dead.error).toMatch(/Address not found/);
    expect(dead.resolved_address).toBeUndefined();
  });

  it("renders each batch dossier as Markdown when asked", async () => {
    mockBanOnly();

    const result: any = await propertyReport({
      addresses: ["10 Rue Test Lyon", "10 nowhere Rue Test Lyon"],
      format: "markdown",
    });

    expect(result.reports[0].format).toBe("markdown");
    expect(result.reports[0].content).toContain("# Dossier immobilier");
    expect(result.reports[1]).toMatchObject({ error: expect.any(String) });
  });

  it("keeps the single-address form's shape unchanged", async () => {
    mockBanOnly();

    const result: any = await propertyReport({ address: "10 Rue Test Lyon" });

    expect(result.resolved_address).toContain("Rue Test");
    expect(result.reports).toBeUndefined();
  });
});

// ------------------------------------------------- validated through the SDK

describe("propertyReport batch through the MCP server", () => {
  it("answers with a batch envelope the declared output schema accepts", async () => {
    mockBanOnly();
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "report-batch-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const res = await client.callTool({
      name: "property_report",
      arguments: { addresses: ["10 Rue Test Lyon", "10 nowhere Rue Test Lyon"] },
    });

    // The SDK validates structuredContent against outputSchema before sending;
    // a shape the schema rejects would come back as a tool error here.
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.query.addresses_count).toBe(2);
    expect(structured.reports).toHaveLength(2);
    expect(structured.reports[0].resolved_address).toContain("Rue Test");
    expect(structured.reports[1].error).toMatch(/Address not found/);

    await server.close();
  });
});
