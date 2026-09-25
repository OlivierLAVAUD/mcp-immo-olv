/**
 * One-off helper: connect to the built MCP server over stdio, list its tools and
 * refresh ui/fixtures/tools.json with the real payload the console receives.
 * Run from the ui/ directory: node capture-tools.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const ENTRY = path.join(REPO_ROOT, "dist", "index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [ENTRY],
  cwd: REPO_ROOT,
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => process.stderr.write(`[mcp] ${chunk}`));

const client = new Client({ name: "fixture-capture", version: "0.5.0" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
writeFileSync(
  path.join(HERE, "fixtures", "tools.json"),
  `${JSON.stringify(tools, null, 2)}\n`,
  "utf8",
);
console.log(`captured ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

await client.close();
process.exit(0);
