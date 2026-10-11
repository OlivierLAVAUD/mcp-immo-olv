#!/usr/bin/env node
/**
 * Entry point. Defaults to stdio — how every MCP client spawns this package.
 * Setting IMMO_HTTP_PORT switches the same tool registry to the Streamable
 * HTTP transport so the server can be hosted and reached remotely.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./http-server.js";

const httpPort = process.env.IMMO_HTTP_PORT;

if (httpPort !== undefined && httpPort !== "") {
  const port = Number(httpPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`IMMO_HTTP_PORT must be a TCP port number (0-65535), got "${httpPort}".`);
    process.exit(1);
  }
  const host = process.env.IMMO_HTTP_HOST ?? "127.0.0.1";
  const running = await startHttpServer({ port, host });
  // Telling the operator where to point a client — never on stdio, where this
  // line would corrupt the JSON-RPC channel.
  console.error(`mcp-immo-olv listening on Streamable HTTP: ${running.url}`);
  const shutdown = () => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
