// End-to-end smoke test against the live public APIs (no MCP transport).
// Run with: npm run smoke
import {
  geocodeAddress,
  propertySales,
  pricePerM2,
  estimateProperty,
  backtestEstimator,
  rentEstimate,
  propertyTaxEstimate,
  propertyReport,
  cadastralParcel,
  urbanismZoning,
  irisLookup,
  rentControl,
  dpeLookup,
  naturalRisks,
  communeInfo,
} from "../dist/handlers.js";

const ADDRESS = process.argv[2] ?? "12 rue de la République Lyon";
let failures = 0;

async function check(name, fn, assert) {
  try {
    const out = await fn();
    const problem = assert(out);
    if (problem) {
      failures++;
      console.log(`✗ ${name}: ${problem}`);
    } else {
      console.log(`✓ ${name}`);
    }
    return out;
  } catch (e) {
    failures++;
    console.log(`✗ ${name}: threw ${e.message}`);
    return null;
  }
}

console.log(`Smoke test address: ${ADDRESS}\n`);

const geo = await check("geocode_address", () => geocodeAddress({ query: ADDRESS }), (o) =>
  o.results.length > 0 ? null : "no geocode results",
);
if (geo) console.log(`  → ${geo.results[0].label} (insee ${geo.results[0].citycode})`);

const sales = await check(
  "property_sales",
  () => propertySales({ address: ADDRESS, radius_m: 400, limit: 5 }),
  (o) => (o.total_matching_sales > 0 ? null : "no sales found"),
);
if (sales) {
  console.log(`  → ${sales.total_matching_sales} sales, latest: ${JSON.stringify(sales.sales[0]?.price_eur)} € on ${sales.sales[0]?.date}`);
}

const stats = await check(
  "price_per_m2",
  () => pricePerM2({ address: ADDRESS, type_local: "Appartement" }),
  (o) => (o.all_period.sales > 0 && o.all_period.median_eur_m2 > 500 ? null : `implausible stats: ${JSON.stringify(o.all_period)}`),
);
if (stats) {
  console.log(`  → all-period median ${stats.all_period.median_eur_m2} €/m² (${stats.all_period.sales} sales), last 12 months ${stats.last_12_months?.median_eur_m2} €/m²`);
}

// Regression: city-wide queries on PLM cities must aggregate arrondissements.
const paris = await check(
  "price_per_m2 city-wide Paris (PLM regression)",
  () => pricePerM2({ address: "Paris", type_local: "Appartement", years: [2024] }),
  (o) => (o.all_period.sales > 10000 && o.all_period.median_eur_m2 > 5000 ? null : `Paris looks wrong: ${JSON.stringify(o.all_period)}`),
);
if (paris) console.log(`  → Paris 2024: ${paris.all_period.sales} sales, median ${paris.all_period.median_eur_m2} €/m²`);

const estimate = await check(
  "estimate_property",
  () => estimateProperty({ address: ADDRESS, type_local: "Appartement", surface_m2: 60, rooms: 3 }),
  (o) => {
    if (!o.estimate || o.estimate.comps_used < 3) return "too few comps";
    if (o.estimate.per_m2.estimate < 1000 || o.estimate.per_m2.estimate > 20000) return `implausible €/m²: ${o.estimate.per_m2.estimate}`;
    return null;
  },
);
if (estimate) {
  console.log(`  → ${estimate.estimate.value_eur.estimate} € (${estimate.estimate.per_m2.estimate} €/m², ${estimate.estimate.comps_used} comps, confidence ${estimate.estimate.confidence})`);
  if (estimate.rental) console.log(`  → rent ${estimate.rental.rent_eur_m2_month} €/m²/month, gross yield ${estimate.rental.gross_yield_pct}%`);
}

const rent = await check(
  "rent_estimate",
  () => rentEstimate({ location: "Villeurbanne", surface_m2: 60 }),
  (o) => (o.indicators.apartment && o.indicators.apartment.rent_eur_m2_month > 5 ? null : "no apartment rent indicator"),
);
if (rent) console.log(`  → Villeurbanne apartment: ${rent.indicators.apartment.rent_eur_m2_month} €/m²/month`);

const propertyTax = await check(
  "property_tax_estimate",
  () => propertyTaxEstimate({ location: ADDRESS }),
  (o) =>
    o.typical_annual_charge_eur > 0 && o.year >= 2024
      ? null
      : `implausible property-tax estimate: ${JSON.stringify(o)}`,
);
if (propertyTax) {
  console.log(
    `  → ${propertyTax.typical_annual_charge_eur} €/year average per taxable article (${propertyTax.year}, ${propertyTax.coverage} coverage)`,
  );
}

const dpe = await check("dpe_lookup", () => dpeLookup({ address: ADDRESS, limit: 3 }), (o) =>
  o.total_found > 0 ? null : "no DPE found",
);
if (dpe) console.log(`  → ${dpe.total_found} DPE, first label: ${dpe.diagnostics[0]?.etiquette_dpe}`);

// The tool degrades to `available: false` when Géorisques is down, so the smoke
// test has to say so explicitly — otherwise an upstream outage would silently
// turn into a green run.
const risks = await check(
  "natural_risks",
  () => naturalRisks({ address: ADDRESS }),
  (o) =>
    o.available === false
      ? `SOURCE UNAVAILABLE — risks at this address are unknown: ${o.unavailable?.reason ?? "no reason given"}`
      : o.naturalRisks.length > 0 || o.technologicalRisks.length > 0
        ? null
        : "empty risk report",
);
if (risks) {
  console.log(
    risks.available === false
      ? `  → unavailable (${risks.unavailable?.reason})`
      : `  → ${risks.naturalRisks.length} natural risks present`,
  );
}

const commune = await check("commune_info", () => communeInfo({ query: "Lyon" }), (o) =>
  o.communes[0]?.population > 100000 ? null : "unexpected commune data",
);
if (commune) console.log(`  → ${commune.communes[0].nom}: ${commune.communes[0].population} inhabitants`);

const report = await check(
  "property_report",
  () => propertyReport({ address: ADDRESS, type_local: "Appartement", surface_m2: 60 }),
  (o) => {
    const sections = ["market", "recent_sales_nearby", "valuation", "rent", "property_tax", "energy_diagnostics", "risks", "commune"];
    // A section that degraded to an explicit "source unavailable" is a failure
    // of this smoke test too: the dossier is incomplete, not just quiet.
    const failed = sections.filter((s) => o[s] && (o[s].error || o[s].available === false));
    return failed.length === 0 ? null : `sections with errors or unavailable sources: ${failed.join(", ")}`;
  },
);
if (report) console.log(`  → full dossier generated for ${report.resolved_address}`);

const cadastre = await check(
  "cadastral_parcel",
  () => cadastralParcel({ address: ADDRESS }),
  (o) => (o.parcels_found > 0 && o.parcels[0].idu ? null : "no cadastral parcel returned"),
);
if (cadastre) {
  console.log(
    `  → parcel ${cadastre.parcels[0].idu} (section ${cadastre.parcels[0].section}), contenance ${cadastre.parcels[0].contenance_m2} m²`,
  );
}

const urbanism = await check(
  "urbanism_zoning",
  () => urbanismZoning({ address: ADDRESS }),
  (o) => (o.zoning_areas.length > 0 ? null : "no PLU zoning returned"),
);
if (urbanism) {
  console.log(
    `  → zone ${urbanism.zoning_areas[0].label} (type ${urbanism.zoning_areas[0].type}), ${urbanism.prescriptions.length} prescriptions`,
  );
}

const neighbourhood = await check(
  "iris_lookup",
  () => irisLookup({ address: ADDRESS }),
  (o) => (o.iris?.code_iris ? null : "no IRIS returned"),
);
if (neighbourhood) {
  console.log(`  → IRIS ${neighbourhood.iris.code_iris} ${neighbourhood.iris.name}`);
}

const rentControlled = await check(
  "rent_control (Paris)",
  () => rentControl({ address: "10 rue de Rivoli Paris", rooms: 2 }),
  (o) =>
    o.covered && o.values.reference_eur_m2_month > 5
      ? null
      : `rent control not covered: ${JSON.stringify(o).slice(0, 140)}`,
);
if (rentControlled) {
  console.log(
    `  → ${rentControlled.city} ${rentControlled.area_label} (${rentControlled.year}): ref ${rentControlled.values.reference_eur_m2_month} €/m², ceiling ${rentControlled.values.ceiling_eur_m2_month} €/m²`,
  );
}

const dpeNeuf = await check(
  "dpe_lookup (both registers)",
  () => dpeLookup({ address: ADDRESS, limit: 2 }),
  (o) => (Array.isArray(o.by_dataset) && o.by_dataset.length === 2 ? null : "missing by_dataset breakdown"),
);
if (dpeNeuf) {
  console.log(
    `  → ${dpeNeuf.by_dataset.map((d) => `${d.dataset}: ${d.total_found}`).join(", ")}`,
  );
}

const backtest = await check(
  "backtest_estimator",
  () => backtestEstimator({ address: ADDRESS, type_local: "Appartement", max_points: 40, from_year: 2023 }),
  (o) =>
    o.evaluated >= 5 && o.overall.mape_pct > 0 && o.overall.interval_coverage_pct !== null
      ? null
      : `implausible backtest: ${JSON.stringify(o.overall)}`,
);
if (backtest) {
  console.log(
    `  → MAPE ${backtest.overall.mape_pct} %, bias ${backtest.overall.bias_pct} %, range coverage ${backtest.overall.interval_coverage_pct} % over ${backtest.evaluated} sales`,
  );
}

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} smoke check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
