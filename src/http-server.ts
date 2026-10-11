/**
 * Streamable HTTP transport — the hosted counterpart of the stdio entry point.
 *
 * `index.ts` stays stdio by default (that is how every MCP client launches this
 * package today). Setting `IMMO_HTTP_PORT` switches the very same tool registry
 * to the MCP Streamable HTTP transport, so the server can be shared, reached
 * remotely, or driven by a client that cannot spawn a subprocess.
 *
 * Design notes:
 *
 *  - **One session, one server.** `McpServer` binds to a single transport, so
 *    each MCP session gets its own `McpServer` + transport pair, keyed by the
 *    `Mcp-Session-Id` header the transport mints on `initialize`. A request
 *    carrying an unknown session is answered 404 by the handler below.
 *  - **Loopback by default.** Like the console bridge, the server binds
 *    127.0.0.1 unless told otherwise: an unauthenticated MCP server exposes the
 *    whole tool surface, so exposing it is an explicit, deliberate act.
 *  - **JSON responses, not SSE.** Every tool is a single request/response — no
 *    server-initiated streams — so `enableJsonResponse` keeps the wire simple
 *    and curl-friendly without losing anything.
 */
import { createServer as createHttpServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

/** The single MCP endpoint every method (GET/POST/DELETE) is served on. */
const ENDPOINT_PATH = "/mcp";

export interface HttpServerOptions {
  /** TCP port to listen on. */
  port: number;
  /** Bind address; defaults to loopback for safety. */
  host?: string;
}

export interface RunningHttpServer {
  /** The URL of the MCP endpoint, ready to hand to a client. */
  url: string;
  close: () => Promise<void>;
}

/** Read and parse a JSON body; returns undefined when there is none. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Start the Streamable HTTP server and resolve once it is listening.
 *
 * Sessions live in a Map that only ever shrinks on `close`, which bounds
 * memory to the number of concurrent MCP clients — the same trade the SDK's own
 * stateful example makes, and the right one for a locally hosted tool server.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const methodNotAllowed = (res: ServerResponse): void => {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The transport owns protocol routing (method semantics, session header,
    // body handling). We dispatch by session and pass the parsed body to avoid
    // a double read on POST.
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) {
      const body = req.method === "POST" ? await readJsonBody(req) : undefined;
      await existing.handleRequest(req, res, body);
      return;
    }

    // Only a POST with no session id can be a fresh `initialize`.
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    const body = await readJsonBody(req);
    if (sessionId || !isInitializeRequest(body)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found. Re-initialize to open a new one." },
          id: null,
        }),
      );
      return;
    }

    // A fresh `initialize`: mint a session-scoped transport + server pair.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const httpServer: Server = createHttpServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== ENDPOINT_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: `Not found: ${pathname}` }, id: null }));
      return;
    }
    handle(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e) }, id: null }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  // Port 0 asks the OS for a free port; read it back so callers (and tests)
  // always get the URL that actually answers.
  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;
  const url = `http://${host}:${boundPort}${ENDPOINT_PATH}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of sessions.values()) void t.close();
        sessions.clear();
        httpServer.close(() => resolve());
      }),
  };
}
