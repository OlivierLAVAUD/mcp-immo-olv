#!/usr/bin/env node
/**
 * OLV Immo — HTTP bridge.
 *
 * The MCP server speaks JSON-RPC over stdio: it is built to be driven by an AI
 * client, not by a browser. This bridge keeps one long-lived MCP session open
 * and re-exposes it as plain HTTP/JSON, so the web console can list the tools
 * and call them without re-implementing the protocol client-side.
 *
 *   GET  /api/health  -> bridge + MCP server status
 *   GET  /api/tools   -> every registered tool, with its JSON input schema
 *   POST /api/call    -> { name, arguments } -> { ok, result, durationMs }
 *
 * It also serves ui/dist when it has been built, so `npm start` is a single
 * port. Node's own http module does the rest — no extra dependency.
 *
 * Environment:
 *   IMMO_UI_PORT         listen port                (default 8787)
 *   IMMO_UI_HOST         bind address               (default 127.0.0.1)
 *   IMMO_CALL_TIMEOUT_MS per-tool-call timeout      (default 180000)
 *   IMMO_MCP_ENTRY       path to the built server   (default <repo>/dist/index.js)
 */
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(UI_ROOT, "..");
const DIST_DIR = path.join(UI_ROOT, "dist");
const SERVER_ENTRY = process.env.IMMO_MCP_ENTRY ?? path.join(REPO_ROOT, "dist", "index.js");

const PORT = Number(process.env.IMMO_UI_PORT ?? 8787);
const HOST = process.env.IMMO_UI_HOST ?? "127.0.0.1";
/**
 * A single `property_report` fans out over whole commune files on the DVF
 * endpoint. Three minutes is not paranoia, it is a Tuesday.
 */
const CALL_TIMEOUT_MS = Number(process.env.IMMO_CALL_TIMEOUT_MS ?? 180_000);

const message = (e) => (e instanceof Error ? e.message : String(e));

// --------------------------------------------------------------- MCP session

let client = null;
let toolsCache = null;
let connecting = null;

async function openSession() {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `MCP server not built: ${SERVER_ENTRY} is missing.\n` +
        `Run "npm run build" at the repository root (${REPO_ROOT}) first.`,
    );
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });

  const forget = () => {
    client = null;
    toolsCache = null;
  };
  transport.onclose = forget;
  transport.onerror = (e) => {
    console.error(`[mcp] transport error: ${message(e)}`);
    forget();
  };

  const c = new Client({ name: "mcp-immo-olv-ui", version: "0.5.0" }, { capabilities: {} });
  await c.connect(transport);
  // Drain the child's stderr: an unconsumed pipe eventually blocks the server.
  transport.stderr?.on("data", (chunk) => process.stderr.write(`[mcp] ${chunk}`));

  client = c;
  toolsCache = null;
  console.log(`[mcp] session open — ${SERVER_ENTRY}`);
}

/** One shared session, re-opened on demand if the child process died. */
async function session() {
  if (client) return client;
  if (!connecting) {
    connecting = openSession().finally(() => {
      connecting = null;
    });
  }
  await connecting;
  if (!client) throw new Error("MCP session could not be established.");
  return client;
}

async function listTools() {
  if (toolsCache) return toolsCache;
  const c = await session();
  const res = await c.listTools();
  toolsCache = Array.isArray(res?.tools) ? res.tools : [];
  return toolsCache;
}

function decodeToolResult(res) {
  const blocks = Array.isArray(res?.content) ? res.content : [];
  const text = blocks
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n");
  // Tools answer with a validated `structuredContent` object next to the legacy
  // text block (MCP 2025-06-18). Take the typed payload when it is there, and
  // fall back to parsing the text so an older server still drives this console.
  let data = res?.structuredContent;
  if (data === undefined) {
    data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON (an error string, say) — keep the raw text.
    }
  }
  return { isError: Boolean(res?.isError), text, data };
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tool "${label}" exceeded ${Math.round(ms / 1000)} s.`)),
      ms,
    );
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), guard]);
}

async function callTool(name, args) {
  const c = await session();
  const started = Date.now();
  const res = await withTimeout(c.callTool({ name, arguments: args ?? {} }), CALL_TIMEOUT_MS, name);
  return { durationMs: Date.now() - started, ...decodeToolResult(res) };
}

// ----------------------------------------------------------------- HTTP layer

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

function send(res, status, body) {
  const isText = typeof body === "string";
  res.writeHead(status, {
    "content-type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(),
  });
  res.end(isText ? body : JSON.stringify(body, null, 2));
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${message(e)}`));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function serveStatic(pathname, res) {
  if (!existsSync(DIST_DIR)) {
    return send(
      res,
      503,
      "The web console is not built yet.\n\n" +
        "  cd ui && npm install && npm run build\n\n" +
        "Or, for hot reload during development:\n\n  cd ui && npm run dev\n",
    );
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  let file = path.join(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR)) return send(res, 403, "Forbidden");
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST_DIR, "index.html");

  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
    ...corsHeaders(),
  });
  createReadStream(file).pipe(res);
}

async function health() {
  try {
    const c = await session();
    const tools = await listTools();
    let server = null;
    try {
      server = c.getServerVersion?.() ?? null;
    } catch {
      server = null;
    }
    return {
      ok: true,
      server,
      toolCount: tools.length,
      serverEntry: SERVER_ENTRY,
      consoleBuilt: existsSync(DIST_DIR),
      callTimeoutMs: CALL_TIMEOUT_MS,
    };
  } catch (e) {
    return { ok: false, error: message(e), serverEntry: SERVER_ENTRY };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (url.pathname === "/api/health") return send(res, 200, await health());

    if (url.pathname === "/api/tools") {
      try {
        return send(res, 200, { ok: true, tools: await listTools() });
      } catch (e) {
        return send(res, 200, { ok: false, error: message(e), tools: [] });
      }
    }

    if (url.pathname === "/api/call") {
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST required." });
      const body = await readJson(req);
      const name = body?.name;
      if (typeof name !== "string" || !name) {
        return send(res, 400, { ok: false, error: "Missing tool name." });
      }
      try {
        const out = await callTool(name, body.arguments);
        return send(res, 200, { ok: !out.isError, tool: name, ...out });
      } catch (e) {
        // A tool error is a normal outcome, not a transport failure: 200 keeps
        // the console simple, `ok:false` carries the meaning.
        return send(res, 200, { ok: false, tool: name, error: message(e), durationMs: null });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return send(res, 404, { ok: false, error: `Unknown endpoint ${url.pathname}` });
    }

    return serveStatic(url.pathname, res);
  } catch (e) {
    return send(res, 500, { ok: false, error: message(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OLV Immo console bridge → http://${HOST}:${PORT}`);
  console.log(`  MCP server : ${SERVER_ENTRY}${existsSync(SERVER_ENTRY) ? "" : "  (MISSING — run npm run build)"}`);
  console.log(`  Static UI  : ${existsSync(DIST_DIR) ? DIST_DIR : "not built (npm run build, or use npm run dev)"}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      await client?.close();
    } catch {
      // best effort
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
