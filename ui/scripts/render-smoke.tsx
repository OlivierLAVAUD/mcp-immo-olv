/**
 * Render smoke test — no browser, no network, no API keys.
 *
 * Everything is driven by payloads captured from the real server:
 *
 *  - fixtures/property-report-lyon.json : a full `property_report` response
 *  - fixtures/tools.json                : the 10 tool descriptors + JSON Schemas
 *
 * Three layers are checked:
 *
 *  1. Cards render with real data. This targets the failure mode data-shape
 *     unit tests miss entirely: a component that throws at render time because
 *     a field is an object where the type claimed string. That is exactly how
 *     `commune.departement` / `commune.region` ({code, nom} from
 *     geo.api.gouv.fr) broke this UI once.
 *  2. Schema → form → arguments coercion behaves for every real tool: blank
 *     forms coerce to an empty payload, filled forms carry every required
 *     argument with the right type, number arrays actually parse.
 *  3. The tool console renders the real tool list, with the required-fields
 *     hint when a required argument is blank.
 *
 * Run from the ui/ directory:  npm run smoke
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import CommuneCard from "../src/components/CommuneCard";
import DpeCard from "../src/components/DpeCard";
import MarketCard from "../src/components/MarketCard";
import PropertyTaxCard from "../src/components/PropertyTaxCard";
import RentCard from "../src/components/RentCard";
import RisksCard from "../src/components/RisksCard";
import SalesTable from "../src/components/SalesTable";
import ValuationCard from "../src/components/ValuationCard";
import { SectionError } from "../src/components/ui";
import {
  effective,
  emptyValues,
  kindOf,
  missingRequired,
  toArguments,
} from "../src/schema";
import type { FieldValue, FormValues } from "../src/schema";
import DossierTab from "../src/tabs/DossierTab";
import ToolConsoleTab from "../src/tabs/ToolConsoleTab";
import type {
  CommuneBlock,
  DpeBlock,
  ErrorBlock,
  JsonSchemaProp,
  MarketBlock,
  PropertyReport,
  PropertyTaxBlock,
  RentBlock,
  RisksBlock,
  SalesBlock,
  ToolInfo,
  ValuationBlock,
} from "../src/types";

const REPORT_FIXTURE = path.resolve(process.cwd(), "fixtures", "property-report-lyon.json");
const TOOLS_FIXTURE = path.resolve(process.cwd(), "fixtures", "tools.json");

const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function render(label: string, element: React.ReactElement): string {
  try {
    return renderToStaticMarkup(element);
  } catch (e) {
    failures.push(`${label} threw during render: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  FAIL ${label} threw: ${e instanceof Error ? e.message : String(e)}`);
    return "";
  }
}

/**
 * renderToStaticMarkup escapes apostrophes (`&#x27;`), quotes and ampersands.
 * Compare against decoded text, otherwise a French label like
 * "Loyers d'annonce officiels" never matches.
 */
function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A plausible value for each kind of field, used to fill the whole form. */
function fillValue(prop: JsonSchemaProp): FieldValue {
  const kind = kindOf(prop);
  if (kind === "enum") return (effective(prop).enum ?? ["x"])[0];
  if (kind === "boolean") return true;
  if (kind === "array") return "2023, 2024";
  if (kind === "number") {
    const min = effective(prop).minimum;
    return typeof min === "number" ? min : 10;
  }
  return "12 rue de la République, Lyon";
}

console.log(`Render smoke test`);
console.log(`  report fixture: ${REPORT_FIXTURE}`);
console.log(`  tools fixture : ${TOOLS_FIXTURE}\n`);

const report = JSON.parse(readFileSync(REPORT_FIXTURE, "utf8")) as PropertyReport;
const tools = JSON.parse(readFileSync(TOOLS_FIXTURE, "utf8")) as ToolInfo[];

// ------------------------------------------------------- 1. cards, real data

console.log("cards rendered with real data");

const cardsHtml = render(
  "cards",
  <div>
    <ValuationCard block={report.valuation as ValuationBlock} />
    <MarketCard block={report.market as MarketBlock} />
    <PropertyTaxCard block={report.property_tax as PropertyTaxBlock} />
    <RentCard block={report.rent as RentBlock} />
    <SalesTable block={report.recent_sales_nearby as SalesBlock} />
    <DpeCard block={report.energy_diagnostics as DpeBlock} />
    <RisksCard block={report.risks as RisksBlock} />
    <CommuneCard block={report.commune as CommuneBlock} />
  </div>,
);

const cardsText = decode(cardsHtml);

const EXPECTED = [
  // valuation
  "Confiance",
  "comparables",
  "Fourchette pondérée",
  "Rendement brut",
  "Rendement après TF moyenne",
  "Taxe foncière moyenne 2025",
  // market
  "Marché — prix au m²",
  "Médiane €/m² par année de vente",
  "12 derniers mois",
  // rent
  "Loyers d'annonce officiels",
  "Appartements 3 pièces et +",
  // sales
  "Ventes notariées récentes",
  "RUE MERCIERE",
  // property tax
  "Taxe foncière — repère communal",
  "Charge moyenne annuelle",
  "Part communale TFPB",
  // dpe
  "Diagnostics de performance énergétique",
  "kWh/m²/an",
  // risks
  "Risques naturels et technologiques",
  "Inondation",
  "Risque Existant",
  // commune — the regression that started this test
  "Auvergne-Rhône-Alpes",
  "Rhône",
  "519",
  // identifiers from the live payload
  "12 Rue de la République 69002 Lyon",
  "21 RUE GENTIL",
  "69123",
];

for (const needle of EXPECTED) {
  check(`contains ${JSON.stringify(needle)}`, cardsText.includes(needle));
}

const FORBIDDEN = ["[object Object]", "NaN", "undefined", "Infinity"];
for (const needle of FORBIDDEN) {
  check(`does not contain ${JSON.stringify(needle)}`, !cardsText.includes(needle));
}

check("markup is substantial", cardsHtml.length > 8000, `${cardsHtml.length} chars`);

// ------------------------------------------------------ 2. failing sections

console.log("\nsection errors are contained");

const err: ErrorBlock = { error: "API injoignable (test)" };
const errorHtml = render(
  "error sections",
  <div>
    <SectionError name="Marché" error={err.error} />
    <MarketCard block={err as unknown as MarketBlock} />
  </div>,
);
check("SectionError renders the message", errorHtml.includes("API injoignable (test)"));
check("MarketCard degrades to an empty state", errorHtml.includes("Aucune vente exploitable"));

// ------------------------------------------------- 3. schema → form → args

console.log(`\nschema coercion over ${tools.length} real tools`);

// Guard against a stale or truncated fixture: the console must be driven by the
// real tool surface (refresh it with `node capture-tools.mjs`). A floor rather
// than an exact count, so shipping a new tool never fails this check for the
// wrong reason.
check("fixture holds the real tool surface", tools.length >= 16, `${tools.length} tools`);

for (const tool of tools) {
  const props = tool.inputSchema?.properties ?? {};
  const propNames = Object.keys(props);

  // A blank form must coerce to a payload that is either empty or holds only
  // legitimately-typed values — never a "" string for a number field.
  const blankArgs = toArguments(emptyValues(tool.inputSchema), tool.inputSchema);
  const blankOk =
    typeof blankArgs === "object" &&
    blankArgs !== null &&
    Object.keys(blankArgs).every((k) => propNames.includes(k)) &&
    Object.entries(blankArgs).every(([k, v]) => {
      const kind = kindOf(props[k]);
      if (kind === "boolean") return typeof v === "boolean";
      return v !== "" && v !== null && v !== undefined;
    });
  check(`${tool.name}: blank form coerces cleanly`, blankOk, JSON.stringify(blankArgs));

  // A fully filled form must carry every required argument, typed correctly.
  const filled: FormValues = {};
  for (const [name, prop] of Object.entries(props)) {
    filled[name] = fillValue(prop);
  }
  const fullArgs = toArguments(filled, tool.inputSchema);
  const required = tool.inputSchema?.required ?? [];
  const missing = required.filter((r) => !(r in fullArgs));
  check(
    `${tool.name}: filled form carries every required argument`,
    missing.length === 0,
    `missing=[${missing.join(", ")}]`,
  );

  const typesOk = Object.entries(fullArgs).every(([k, v]) => {
    const kind = kindOf(props[k]);
    if (kind === "number") return typeof v === "number";
    if (kind === "enum") return typeof v === "string";
    if (kind === "array") return Array.isArray(v);
    if (kind === "boolean") return typeof v === "boolean";
    return typeof v === "string";
  });
  check(`${tool.name}: every coerced value has the right type`, typesOk, JSON.stringify(fullArgs));

  if ("years" in props && kindOf(props.years) === "array") {
    const years = fullArgs.years as unknown[];
    check(
      `${tool.name}: years parses to number[]`,
      Array.isArray(years) && years.length === 2 && years.every((v) => typeof v === "number"),
      JSON.stringify(years),
    );
  }
}

// missingRequired is what the console's hint is built on.
const rg = tools.find((t) => t.name === "reverse_geocode");
if (rg) {
  const blank = emptyValues(rg.inputSchema);
  const missing = missingRequired(blank, rg.inputSchema);
  check(
    "reverse_geocode: blank form reports lat/lon as missing",
    missing.length === 2 && missing.includes("lat") && missing.includes("lon"),
    JSON.stringify(missing),
  );
  const filled: FormValues = { ...blank, lat: 45.76, lon: 4.83 };
  check(
    "reverse_geocode: filled form reports nothing missing",
    missingRequired(filled, rg.inputSchema).length === 0,
  );
}

// ------------------------------------------- 4. tool console with real tools

console.log("\ntool console renders the real tool list");

const toolsHtml = render("ToolConsoleTab with real tools", <ToolConsoleTab initialTools={tools} />);
const toolsText = decode(toolsHtml);

for (const tool of tools) {
  check(`lists ${tool.name}`, toolsText.includes(tool.name));
}

const first = tools[0];
if (first) {
  const firstBlank = emptyValues(first.inputSchema);
  if (missingRequired(firstBlank, first.inputSchema).length > 0) {
    check("required-fields hint shows for the selected tool", toolsText.includes("Requis non renseigné"));
  }
  const firstProp = Object.keys(first.inputSchema?.properties ?? {})[0];
  const firstDesc = effective(first.inputSchema?.properties?.[firstProp] ?? {}).description;
  if (firstDesc) {
    check(
      "field label carries the schema description",
      toolsText.includes(firstDesc),
      firstDesc.slice(0, 60),
    );
  }
}

// ------------------------------------------------------------- 5. tab shells

console.log("\ntab shells render without a bridge");

const dossierHtml = render("DossierTab", <DossierTab />);
check("dossier form is present", dossierHtml.includes("Nouveau dossier"));
check("dossier submit button is present", dossierHtml.includes("Générer le dossier"));

// ------------------------------------------------------------------ outcome

console.log("");
if (failures.length === 0) {
  console.log("All render checks passed.");
  process.exit(0);
}
console.log(`${failures.length} render check(s) FAILED:`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);
