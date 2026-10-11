import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";

let running: RunningHttpServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.unstubAllGlobals();
});

/**
 * The server under test talks to a real MCP client over localhost fetch, while
 * its tools reach out to open-data APIs. Keep the loopback leg real and answer
 * the outbound leg with a fixture, so the whole suite runs offline — the same
 * rule every other test here follows.
 */
function stubOutbound(citycode: string): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof URL ? input.href : input);
      if (url.includes("geo.api.gouv.fr")) {
        return new Response(JSON.stringify({ nom: "Fixture", code: citycode }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input as never, init);
    }),
  );
}

/** Connect a real MCP client over Streamable HTTP to a fresh server. */
async function connect(): Promise<{ client: Client; sessionId: string | undefined }> {
  running = await startHttpServer({ port: 0 });
  const client = new Client({ name: "http-server-test", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(running.url));
  await client.connect(transport);
  return { client, sessionId: transport.sessionId };
}

describe("Streamable HTTP transport", () => {
  it("serves the full tool registry over HTTP", async () => {
    const { client } = await connect();

    const tools = await client.listTools();
    // The same 21 tools the stdio server registers — the registry is shared.
    expect(tools.tools.length).toBe(21);
    expect(tools.tools.map((t) => t.name)).toContain("nearby_amenities");
    expect(tools.tools.map((t) => t.name)).toContain("estimate_property");
  });

  it("answers a tool call with structured content, and mints a session id", async () => {
    stubOutbound("69123");
    const { client, sessionId } = await connect();

    // A minted session id is what makes this a stateful transport.
    expect(sessionId).toBeTruthy();

    const res = await client.callTool({
      name: "commune_info",
      arguments: { query: "69123" },
    });

    expect(res.isError).toBeFalsy();
    // The tool answers twice on purpose: text block + structuredContent.
    expect(res.structuredContent).toBeTruthy();
    expect(res.structuredContent).toHaveProperty("source");
  });

  it("rejects a call that carries an unknown session id", async () => {
    running = await startHttpServer({ port: 0 });

    const res = await fetch(running.url, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-session-id": "nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    // Our handler answers 404 for a session it never minted.
    expect(res.status).toBe(404);
  });

  it("answers 404 on a non-MCP path and 405 on a disallowed method", async () => {
    running = await startHttpServer({ port: 0 });
    const base = new URL(running.url).origin;

    const notFound = await fetch(`${base}/definitely-not-mcp`);
    expect(notFound.status).toBe(404);

    // GET with no session cannot be an initialize, so it is not routed.
    const badGet = await fetch(running.url, { method: "GET" });
    expect(badGet.status).toBe(405);
  });

  it("keeps two sessions independent", async () => {
    stubOutbound("75056");
    running = await startHttpServer({ port: 0 });
    const url = new URL(running.url);

    const make = async () => {
      const c = new Client({ name: "iso", version: "1.0.0" }, { capabilities: {} });
      const t = new StreamableHTTPClientTransport(url);
      await c.connect(t);
      return { c, t };
    };

    const a = await make();
    const b = await make();
    // Each client got its own session: same server, different transports.
    expect(a.t.sessionId).toBeTruthy();
    expect(b.t.sessionId).toBeTruthy();
    expect(a.t.sessionId).not.toBe(b.t.sessionId);

    const ra = await a.c.callTool({ name: "commune_info", arguments: { query: "75056" } });
    const rb = await b.c.callTool({ name: "commune_info", arguments: { query: "13055" } });
    expect(ra.isError).toBeFalsy();
    expect(rb.isError).toBeFalsy();
  });
});