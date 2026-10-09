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
/** Nullable figure → printable string; a missing figure reads "—", never 0. */
const nf = (v, digits = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const pad = (v, n) => String(v).padEnd(n);
const padStart = (v, n) => String(v).padStart(n);

const ADDRESS = process.argv[2] ?? "12 rue de la République Lyon";
const OTHER = process.argv[3] ?? "10 place des Terreaux Lyon";
const NOWHERE = "10 rue inexistante zzzzz 99999 Nulleville";
const BUDGET = 250_000;
const ZONE = "69";
console.log(`\nExemples live — serveur ${path.relative(ROOT, path.join(ROOT, "dist/index.js"))}, adresses « ${ADDRESS} » / « ${OTHER} »\n`);

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
// nearby_amenities: what is around the address, from OpenStreetMap. Distances
// are crow-flies, and an unreachable source must read as unknown.
console.log("\n2. nearby_amenities — ce qu'il y a autour (OpenStreetMap)");
const aroundStart = Date.now();
const around = await call("nearby_amenities", { address: ADDRESS, radius_m: 800, limit: 2 });
if (around.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(around)}`);
} else {
  const s = around.structuredContent;
  console.log(`   available=${s.available}  rayon=${s.radius_m} m  point=${s.point.lat.toFixed(5)},${s.point.lon.toFixed(5)}   (${Date.now() - aroundStart} ms)`);
  for (const c of s.categories) {
    const near = c.nearest.map((p) => `${p.name ?? "(sans nom)"} ${p.type} ${p.distance_m} m`).join(" | ");
    console.log(
      `   ${pad(c.key, 10)} count=${padStart(nf(c.count), 4)}  plus proche=${padStart(nf(c.nearest_distance_m), 4)} m  → ${near || "—"}`,
    );
  }
  expect("nearby_amenities", "les 5 catégories sont toujours répondues", s.categories.length === 5);
  // The rule that matters: a source outage gives null counts, an empty
  // neighbourhood gives zeros — the two must never look alike.
  expect(
    "nearby_amenities",
    "source injoignable = count null (inconnu), jamais 0",
    s.available
      ? s.categories.every((c) => c.count !== null)
      : s.categories.every((c) => c.count === null && c.nearest.length === 0),
  );
  if (s.available) {
    const sorted = s.categories.every((c) => c.nearest.every((p, i) => i === 0 || c.nearest[i - 1].distance_m <= p.distance_m));
    const coherent = s.categories.every((c) => (c.count === 0 ? c.nearest_distance_m === null : c.nearest[0].distance_m === c.nearest_distance_m));
    expect("nearby_amenities", "distances croissantes et cohérentes avec count", sorted && coherent);
    expect(
      "nearby_amenities",
      "chaque POI est traçable à son objet OSM",
      s.categories.every((c) => c.nearest.every((p) => /^(node|way|relation)\/\d+$/.test(p.osm))),
    );
    expect("nearby_amenities", "au moins une catégorie est renseignée en ville", s.categories.some((c) => c.count > 0));
  }
}

// 3 --------------------------------------------------------------------------
// compare_properties: 2–5 addresses side by side, one row each, rankings as
// row indices.
console.log("\n3. compare_properties — deux adresses côte à côte");
let t = Date.now();
const cmp = await call("compare_properties", {
  targets: [
    { address: OTHER, type_local: "Appartement", surface_m2: 55, rooms: 3 },
    { address: ADDRESS, type_local: "Appartement", surface_m2: 70, rooms: 4 },
  ],
});
if (cmp.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(cmp)}`);
} else {
  const s = cmp.structuredContent;
  console.log(`   query : ${JSON.stringify(s.query)}   (${Date.now() - t} ms)`);
  console.log(`   ${pad("#", 2)} ${pad("adresse résolue", 42)} ${padStart("€/m² 12 m", 9)} ${padStart("ventes", 7)} ${padStart("estimation €", 12)} ${pad("conf.", 6)} ${padStart("loyer €/m²", 9)} ${pad("DPE", 4)} ${padStart("rend. %", 7)}`);
  for (const [i, r] of s.rows.entries()) {
    console.log(
      `   ${pad(i, 2)} ${pad(r.resolved_address ?? "(non résolue)", 42)} ` +
        `${padStart(nf(r.market?.median_eur_m2_last_12m), 9)} ${padStart(nf(r.market?.sales_last_12m), 7)} ` +
        `${padStart(nf(r.valuation?.value_eur.estimate), 12)} ${pad(r.valuation?.confidence ?? "—", 6)} ` +
        `${padStart(nf(r.rent?.rent_eur_m2_month, 1), 9)} ${pad(r.energy?.energy_label ?? "—", 4)} ` +
        `${padStart(nf(r.valuation?.gross_yield_pct, 1), 7)}`,
    );
  }
  const named = (indices) => `${JSON.stringify(indices)} → ${indices.map((i) => s.rows[i]?.resolved_address ?? `#${i}`).join(", ") || "(aucun)"}`;
  console.log(`   classements :`);
  console.log(`     cheapest_eur_m2      ${named(s.rankings.cheapest_eur_m2)}`);
  console.log(`     best_gross_yield_pct ${named(s.rankings.best_gross_yield_pct)}`);
  const errored = s.rows.flatMap((r, i) => Object.entries(r.errors).map(([k, v]) => `#${i} ${k}: ${v}`));
  console.log(`   sections en erreur : ${errored.length === 0 ? "aucune" : errored.join(" | ")}`);

  expect("compare_properties", "une ligne par adresse, une adresse résolue chacune", s.rows.length === 2 && s.rows.every((r) => r.resolved_address));
  expect("compare_properties", "chaque ligne porte marché, estimation, loyer et DPE", s.rows.every((r) => r.market && r.valuation && r.rent && r.energy));
  // Rankings are row indices, and a row with no figure is absent from the
  // ranking rather than ranked last.
  const idxOk = (indices, has) =>
    indices.every((i) => Number.isInteger(i) && i >= 0 && i < s.rows.length && has(s.rows[i]));
  expect("compare_properties", "cheapest_eur_m2 = indices de lignes classées du moins cher au plus cher", idxOk(s.rankings.cheapest_eur_m2, (r) => r.market?.median_eur_m2_last_12m !== null && r.market !== null));
  expect("compare_properties", "best_gross_yield_pct = indices de lignes ayant un rendement", idxOk(s.rankings.best_gross_yield_pct, (r) => r.valuation?.gross_yield_pct !== null && r.valuation !== null));
  const prices = s.rankings.cheapest_eur_m2.map((i) => s.rows[i].market.median_eur_m2_last_12m);
  expect("compare_properties", "le classement prix est croissant", prices.every((p, i) => i === 0 || prices[i - 1] <= p));
}

// 3 --------------------------------------------------------------------------
// search_by_budget: the inverse search — what a budget reaches, commune by
// commune, with thin-data communes excluded rather than ranked last.
console.log(`\n4. search_by_budget — ce qu'un budget de ${nf(BUDGET)} € atteint dans le département ${ZONE}`);
t = Date.now();
const budget = await call("search_by_budget", {
  budget_eur: BUDGET,
  type_local: "Appartement",
  zone: ZONE,
  max_communes: 6,
});
if (budget.isError) {
  failures++;
  console.log(`  ✗ appel en erreur : ${first(budget)}`);
} else {
  const s = budget.structuredContent;
  console.log(`   type=${s.type_local}  zone=${s.zone.input}  communes_scanned=${s.zone.communes_scanned}  années=${s.years_used.join(",")}   (${Date.now() - t} ms)`);
  console.log(`   ${pad("commune", 26)} ${padStart("pop.", 8)} ${padStart("€/m² 12 m", 9)} ${padStart("surf. max", 9)} ${padStart("loyer €/m²", 9)} ${padStart("loyer €/mois", 12)} ${padStart("rend. %", 7)}`);
  for (const c of s.communes) {
    console.log(
      `   ${pad(`${c.name} (${c.insee_code})`, 26)} ${padStart(nf(c.population), 8)} ` +
        `${padStart(nf(c.price.median_eur_m2_last_12m ?? c.price.median_eur_m2_all_period), 9)} ${padStart(nf(c.surface.max_surface_m2), 9)} ` +
        `${padStart(nf(c.rent.rent_eur_m2_month, 1), 9)} ${padStart(nf(c.rent.estimated_monthly_rent_eur), 12)} ${padStart(nf(c.gross_yield_pct, 1), 7)}`,
    );
  }
  const named = (indices) => `${JSON.stringify(indices)} → ${indices.map((i) => s.communes[i]?.name ?? `#${i}`).join(", ") || "(aucun)"}`;
  console.log(`   classements :`);
  console.log(`     most_surface         ${named(s.rankings.most_surface)}`);
  console.log(`     cheapest_eur_m2      ${named(s.rankings.cheapest_eur_m2)}`);
  console.log(`     best_gross_yield_pct ${named(s.rankings.best_gross_yield_pct)}`);
  console.log(`   données insuffisantes (${s.not_enough_data.length}) : ${s.not_enough_data.map((d) => `${d.name} (${d.sales} ventes)`).join(", ") || "aucune"}`);
  console.log(`   erreurs (${s.errors.length}) : ${s.errors.map((e) => `${e.name}: ${e.reason}`).join(", ") || "aucune"}`);

  expect("search_by_budget", "le budget est repris tel quel", s.budget_eur === BUDGET);
  expect("search_by_budget", "des communes qualifient", s.communes.length > 0);
  expect("search_by_budget", "le scan reste borné", s.zone.communes_scanned <= 6);
  // The headline figure: surface = budget ÷ median €/m², computed from the
  // median the same row reports.
  const surfacesOk = s.communes.every((c) => {
    const price = c.price.median_eur_m2_last_12m ?? c.price.median_eur_m2_all_period;
    return c.surface.max_surface_m2 === Math.floor(s.budget_eur / price);
  });
  expect("search_by_budget", "surface max = budget ÷ médiane €/m² de la ligne", surfacesOk);
  const idxOk = (indices, has) => indices.every((i) => Number.isInteger(i) && i >= 0 && i < s.communes.length && has(s.communes[i]));
  expect("search_by_budget", "most_surface = indices des communes classées", idxOk(s.rankings.most_surface, (c) => c.surface.max_surface_m2 !== null));
  expect("search_by_budget", "best_gross_yield_pct ne classe que des rendements connus", idxOk(s.rankings.best_gross_yield_pct, (c) => c.gross_yield_pct !== null));
  const surfaces = s.rankings.most_surface.map((i) => s.communes[i].surface.max_surface_m2);
  expect("search_by_budget", "le classement surface est décroissant", surfaces.every((v, i) => i === 0 || surfaces[i - 1] >= v));
  // Thin data is set aside explicitly, never merged into the ranking.
  const qualifying = new Set(s.communes.map((c) => c.insee_code));
  expect("search_by_budget", "les communes sans données sont listées à part", s.not_enough_data.every((d) => !qualifying.has(d.insee_code) && typeof d.name === "string"));
  expect("search_by_budget", "les limites méthodologiques sont annoncées", s.caveats.length >= 4 && s.note.includes("indices"));
}

// 4 --------------------------------------------------------------------------
// property_report format=markdown: the dossier as a shareable fiche.
console.log("\n5. property_report format=markdown — une fiche partageable");
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

// 5 --------------------------------------------------------------------------
// batch: one dossier per address, a bad address isolated.
console.log("\n6. property_report batch — une adresse en échec n'entraîne pas le lot");
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

// 6 --------------------------------------------------------------------------
// argument rules: the message a client reads when the batch is malformed.
console.log("\n7. property_report — messages d'erreur des lots hors bornes");
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
