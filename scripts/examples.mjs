// Live examples — the features verified by concrete example, not only by
// assertions. Drives the BUILT server over the real MCP stdio transport, the
// same way a client does, and prints what that client receives.
//
// Run with: npm run examples   (needs network: public open-data APIs)
//
// Each example both prints its real output and checks the contract it is meant
// to demonstrate, so a regression fails here loudly instead of merely looking
// different.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "dist", "index.js")],
  cwd: ROOT,
  stderr: "pipe",
});
transport.stderr?.on("data", (c) => process.stderr.write(`[mcp] ${c}`));

const client = new Client({ name: "examples", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

let failures = 0;
function expect(example, what, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${what}`);
  } else {
    failures++;
    console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`);
  }
}
const call = (name, args) => client.callTool({ name, arguments: args });
const first = (r) => (r.content?.[0]?.text ?? "").split("\n")[0];

const ADDRESS = process.argv[2] ?? "12 rue de la République Lyon";
const OTHER = process.argv[3] ?? "10 place des Terreaux Lyon";
const NOWHERE = "10 rue inexistante zzzzz 99999 Nulleville";
console.log(`\nExemples live — serveur ${path.relative(ROOT, path.join(ROOT, "dist/index.js"))}, adresse ${ADDRESS}\n`);

// 1 --------------------------------------------------------------------------
// risk_summary: one sentence per risk, explicit about the unknown.
console.log("1. risk_summary — une phrase par risque");
// Géorisques is intermittently unreachable; the example retries so the degraded
// branch is shown only when the source really stays down (it must still read
// unknown, so the retry hides nothing).
let digest;
for (let attempt = 1; attempt <= 3; attempt++) {
  digest = await call("risk_summary", { address: ADDRESS });
  if (digest.isError || digest.structuredContent.available) break;
  if (attempt < 3) {
    console.log(`   (Géorisques injoignable, tentative ${attempt}/3 — nouvel essai)`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
if (digest.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(digest)}`);
} else {
  const s = digest.structuredContent;
  console.log(`   available=${s.available}  signals_count=${s.signals_count}`);
  console.log(`   headline : ${s.headline}`);
  for (const it of s.items) console.log(`     [${it.status.padEnd(7)}] ${it.sentence}`);
  console.log(`   other_present_risks : ${JSON.stringify(s.other_present_risks)}`);
  expect("risk_summary", "les 5 catégories sont toujours répondues", s.items.length === 5);
  expect("risk_summary", "chaque phrase est non vide", s.items.every((i) => i.sentence));
  // A source that did not answer must read unknown, never absent.
  expect(
    "risk_summary",
    "une source injoignable donne « unknown », jamais « absent »",
    s.available || s.items.filter((i) => i.key !== "dpe").every((i) => i.status === "unknown"),
  );
  if (s.available) {
    expect("risk_summary", "rien de présent n'est masqué", Array.isArray(s.other_present_risks));
    expect("risk_summary", "le titre n'abîme pas les sigles", !s.headline.includes("(icpe)"));
  }
}

// 2 --------------------------------------------------------------------------
// property_report format=markdown: the dossier as a shareable fiche.
console.log("\n2. property_report format=markdown — une fiche partageable");
const md = await call("property_report", {
  address: ADDRESS,
  type_local: "Appartement",
  surface_m2: 60,
  rooms: 3,
  format: "markdown",
});
if (md.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(md)}`);
} else {
  const { format, content } = md.structuredContent;
  console.log(`   format=${format}  ${content.length} caractères`);
  console.log("   --- extrait ---");
  console.log(content.split("\n").slice(0, 16).map((l) => `   | ${l}`).join("\n"));
  console.log("   | …");
  const headings = content.split("\n").filter((l) => l.startsWith("## "));
  console.log(`   sections : ${headings.map((h) => h.slice(3)).join(", ")}`);
  expect("markdown", "format = markdown", format === "markdown");
  expect("markdown", "un titre et la mention d'avis de valeur", content.includes("# Dossier immobilier") && content.includes("pas un avis de valeur professionnel"));
  expect("markdown", "les sections clés sont présentes", ["Marché", "Estimation", "DPE", "Risques", "Sources"].every((h) => content.includes(`## ${h}`)));
  // An unreachable Géorisques must not render as a clean "no risk".
  const risksLine = content.split("\n").find((l) => l.includes("Statut INCONNU"));
  const risksAbsent = content.includes("Risques (Géorisques)") && !content.includes("## Risques (Géorisques)\n\nAucun");
  expect("markdown", "Géorisques injoignable = INCONNU explicite", risksLine !== undefined || risksAbsent);
}

// 3 --------------------------------------------------------------------------
// batch: one dossier per address, a bad address isolated.
console.log("\n3. property_report batch — une adresse en échec n'entraîne pas le lot");
const batch = await call("property_report", {
  addresses: [OTHER, NOWHERE],
  type_local: "Appartement",
  surface_m2: 55,
});
if (batch.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(batch)}`);
} else {
  const s = batch.structuredContent;
  console.log(`   query : ${JSON.stringify(s.query)}`);
  for (const e of s.reports) {
    console.log(`   - ${e.input_address}`);
    console.log(e.error ? `       error: ${e.error}` : `       resolved_address: ${e.resolved_address}  (sections: ${Object.keys(e).length - 2})`);
  }
  expect("batch", "une entrée par adresse, dans l'ordre", s.reports.length === 2 && s.reports[0].input_address === OTHER);
  expect("batch", "l'adresse valide produit un dossier complet", Boolean(s.reports[0].resolved_address) && Boolean(s.reports[0].market));
  expect("batch", "l'adresse invalide porte son propre error", /Address not found/.test(s.reports[1].error ?? ""));
  expect("batch", "le lot annonce le profil partagé", s.query.surface_m2 === 55 && s.query.type_local === "Appartement");
}

// 4 --------------------------------------------------------------------------
// argument rules: the message a client reads when the batch is malformed.
console.log("\n4. property_report — messages d'erreur des lots hors bornes");
for (const [label, args, expected] of [
  ["1 seule adresse", { addresses: [ADDRESS] }, "at least 2 addresses"],
  ["6 adresses", { addresses: Array(6).fill(ADDRESS) }, "at most 5 addresses"],
  ["address + addresses", { address: ADDRESS, addresses: [ADDRESS, OTHER] }, "not both"],
  ["aucune adresse", {}, "needs an `address`"],
]) {
  const res = await call("property_report", args);
  const line = first(res);
  console.log(`   ${label} → ${line}`);
  expect("validation", `${label} : erreur explicite`, res.isError === true && res.content[0].text.includes(expected));
}

await client.close();
console.log(failures === 0 ? "\nTous les exemples sont conformes.\n" : `\n${failures} exemple(s) NON conformes.\n`);
process.exit(failures === 0 ? 0 : 1);
