import { dpeByAddress, dpeByBanId, DPE_DATASET_LABELS, DPE_DATASET_ORDER } from "../apis/dpe.js";
import { annualEnergyCost, rentalCompliance } from "../dpe-compliance.js";
import { riskReport, GEORISQUES_PORTAL } from "../apis/georisques.js";
import { summarizeRisks } from "../risk-summary.js";
import type { RentalCompliance } from "../dpe-compliance.js";
import { communeByCode, communesByName } from "../apis/communes.js";
import { parcelsAtPoint, CADASTRE_SOURCE, CADASTRE_SOURCE_URL } from "../apis/cadastre.js";
import { zonesAtPoint, prescriptionsAtPoint, GPU_SOURCE, GPU_SOURCE_URL } from "../apis/gpu.js";
import { irisAtPoint, IRIS_SOURCE, IRIS_SOURCE_URL } from "../apis/iris.js";
import {
  fetchNearby,
  nearestByCategory,
  unavailableAmenities,
  OSM_SOURCE,
  OSM_LICENSE_URL,
} from "../apis/overpass.js";
import { rentControlAtPoint } from "../apis/rent_control.js";
import { reverseGeocode } from "../apis/ban.js";
import { round } from "../util/stats.js";
import { locate, resolvePoint } from "./shared.js";

export async function dpeLookup(args: {
  address: string;
  limit?: number;
  dataset?: "all" | "existant" | "neuf";
  energy_price_eur_kwh?: number;
}) {
  const { geo } = await locate(args.address);
  const size = Math.min(args.limit ?? 10, 50);
  const wanted = args.dataset ?? "all";
  const datasets = wanted === "all" ? DPE_DATASET_ORDER : [wanted];
  const addressQuery = [geo.housenumber, geo.street].filter(Boolean).join(" ") || geo.label;

  // Each vintage is its own ADEME dataset. Querying both is what separates
  // "no diagnostic on file" from "no *existing-dwelling* diagnostic on file".
  const perDataset = await Promise.all(
    datasets.map(async (dataset) => {
      let match: "exact BAN id" | "address search" = "exact BAN id";
      let res = geo.banId ? await dpeByBanId(geo.banId, size, dataset) : { total: 0, results: [] };
      if (res.total === 0) {
        match = "address search";
        res = await dpeByAddress(addressQuery, geo.citycode!, size, dataset);
      }
      return {
        dataset,
        label: DPE_DATASET_LABELS[dataset],
        match,
        total_found: res.total,
        diagnostics: res.results.map((record) => ({
          ...record,
          dataset,
          // Rental legality is computed per diagnostic: the register can hold
          // several vintages for one address, and only the newest counts in law.
          rental_compliance: rentalCompliance(record.etiquette_dpe),
          annual_energy_cost: annualEnergyCost(
            record.conso_5_usages_par_m2_ep,
            record.surface_habitable_logement,
            args.energy_price_eur_kwh,
          ),
        })),
      };
    }),
  );

  return {
    source: "ADEME — DPE logements existants (dpe03existant) & neufs (dpe02neuf), open data",
    query: { resolved_address: geo.label, ban_id: geo.banId },
    total_found: perDataset.reduce((sum, entry) => sum + entry.total_found, 0),
    by_dataset: perDataset.map(({ dataset, label, match, total_found }) => ({
      dataset,
      label,
      match,
      total_found,
    })),
    diagnostics: perDataset.flatMap((entry) => entry.diagnostics),
    note: "etiquette_dpe = energy label (A best – G worst), etiquette_ges = greenhouse-gas label. conso_5_usages_par_m2_ep is primary energy in kWh/m²/year. `dataset` states which register the row came from. rental_compliance gives the legal rental status of a main-residence lease at the label (décret n° 2024-501: G/H banned since 2025-01-01, F from 2028-01-01, E from 2034-01-01) — 'inconnu' means the label is missing, never that the dwelling is lettable. annual_energy_cost is the consumption figure monetised at energy_price_eur_kwh (default 0.2562 €/kWh), an order of magnitude, not a bill.",
  };
}

export async function naturalRisks(args: { address?: string; lat?: number; lon?: number }) {
  const { lat, lon, resolved } = await resolvePoint(args);
  const report = await riskReport(lat, lon);
  return {
    source: "Géorisques, Ministère de la Transition écologique",
    resolved_address: resolved ?? report.address,
    ...report,
    // An outage must never read as a clean bill of health: `available: false`
    // means the status is unknown, not that the address is risk-free.
    note: report.available
      ? "Only the risks Géorisques reports as present are listed: statusAtAddress is the situation at this exact address, statusInCommune the one elsewhere in the commune."
      : "Géorisques could not be reached, so the risk status at this address is UNKNOWN. This is not a statement that the address is risk-free — retry later, or check the official portal.",
  };
}

/**
 * Consumer-grade risk digest: one plain sentence per risk (flood, clay, radon,
 * industrial sites, DPE rental ban), plus a one-line headline. Géorisques and
 * the DPE are the same sources the detailed tools use, so the two can never
 * disagree. An unreachable source reads as UNKNOWN on every line it covers.
 */
export async function riskSummary(args: { address?: string; lat?: number; lon?: number }) {
  const { lat, lon, resolved } = await resolvePoint(args);
  const risks = await riskReport(lat, lon);

  // The DPE needs an address (it is keyed to one in ADEME); without it the
  // digest still answers, and marks the DPE explicitly as not checked.
  let dpeState: "checked" | "not_checked" | "error" = "not_checked";
  let compliance: RentalCompliance | null = null;
  let dpeError: string | null = null;
  if (args.address !== undefined) {
    try {
      const dpe = await dpeLookup({ address: args.address, limit: 1 });
      const first = dpe.diagnostics[0] as { rental_compliance?: RentalCompliance } | undefined;
      compliance = first?.rental_compliance ?? null;
      dpeState = "checked";
    } catch (e) {
      dpeState = "error";
      dpeError = e instanceof Error ? e.message : String(e);
    }
  }

  const summary = summarizeRisks({ risks, dpe: { state: dpeState, compliance } });

  return {
    source: "Géorisques, Ministère de la Transition écologique + ADEME (DPE)",
    source_url: risks.officialReportUrl ?? GEORISQUES_PORTAL,
    resolved_address: resolved ?? risks.address,
    available: risks.available,
    point: { lat, lon },
    headline: summary.headline,
    signals_count: summary.signals_count,
    items: summary.items,
    other_present_risks: summary.other_present_risks,
    unavailable: risks.unavailable,
    dpe_error: dpeError,
    note: risks.available
      ? "One line per risk. `absent` means Géorisques did not report it present at this point; `unknown` means the answer is missing, never that the address is safe. other_present_risks lists anything present outside the summarised categories."
      : "Géorisques could not be reached, so every risk status here is UNKNOWN — this is not a risk-free address. The DPE line is reported independently.",
    caveats: [
      "A digest, not a substitute for the full reports: see natural_risks and dpe_lookup for the underlying detail.",
      "Géorisques lists declared risks at a point; it does not quantify your exposure or the cost of insuring against it.",
      "This is public-data analysis, not a professional appraisal or a technical diagnosis.",
    ],
  };
}

export async function communeInfo(args: { query: string }) {
  const q = args.query.trim();
  const isCode = /^\d[0-9AB]\d{3}$/i.test(q);
  const communes = isCode ? [await communeByCode(q.toUpperCase())] : await communesByName(q);
  if (communes.length === 0) throw new Error(`No commune found for "${q}".`);
  return {
    source: "geo.api.gouv.fr (INSEE)",
    communes: communes.map((c) => ({
      nom: c.nom,
      insee_code: c.code,
      postcodes: c.codesPostaux,
      departement: c.departement,
      region: c.region,
      population: c.population,
      surface_km2: c.surface !== undefined ? round(c.surface / 100, 1) : undefined,
      center: c.centre?.coordinates ? { lon: c.centre.coordinates[0], lat: c.centre.coordinates[1] } : undefined,
    })),
  };
}

export async function whatIsHere(args: { lat: number; lon: number }) {
  const results = await reverseGeocode(args.lat, args.lon);
  return { source: "Base Adresse Nationale (BAN)", results };
}

/**
 * Cadastral parcels under a point: the tax unit, its official contenance and
 * the `idu` quoted on deeds and tax notices.
 */
export async function cadastralParcel(args: { address?: string; lat?: number; lon?: number }) {
  const { lat, lon, resolved } = await resolvePoint(args);
  const parcels = await parcelsAtPoint(lat, lon);
  return {
    source: CADASTRE_SOURCE,
    source_url: CADASTRE_SOURCE_URL,
    resolved_address: resolved,
    point: { lat, lon },
    parcels_found: parcels.length,
    parcels,
    note: "contenance_m2 is the cadastral taxed area of the whole parcel, land included — not the dwelling's habitable surface.",
    caveats: [
      "The cadastre records the tax parcel, never ownership: it does not say who owns the land.",
      "One parcel may hold several buildings, or none, and it says nothing about building rights.",
    ],
  };
}

/** Local urbanism rules (PLU / PLUi / POS) at a point, via the Géoportail de l'urbanisme. */
export async function urbanismZoning(args: { address?: string; lat?: number; lon?: number }) {
  const { lat, lon, resolved } = await resolvePoint(args);
  const [zoning, prescriptions] = await Promise.all([
    zonesAtPoint(lat, lon),
    prescriptionsAtPoint(lat, lon),
  ]);

  return {
    source: GPU_SOURCE,
    source_url: GPU_SOURCE_URL,
    resolved_address: resolved,
    point: { lat, lon },
    zoning_areas: zoning,
    prescriptions,
    coverage_note:
      zoning.length === 0 && prescriptions.length === 0
        ? "No urbanism document is published for this point in the GPU: the commune may have no opposable PLU, or its document is not digitised there."
        : undefined,
    note: "zone type: U urban, AU to be urbanised, A agricultural, N natural. The local label and the regulation file are what actually govern building.",
    caveats: [
      "This states which rules apply, never whether a project is allowed: read the règlement and, before a purchase, request a certificat d'urbanisme.",
      "The GPU publishes opposable documents only; a commune with no PLU is simply absent from it.",
    ],
  };
}

/** The IRIS — INSEE's infra-communal unit — containing a point. */
export async function irisLookup(args: { address: string }) {
  const { geo } = await locate(args.address);
  const iris = await irisAtPoint(geo.lat, geo.lon, geo.citycode!);
  return {
    source: IRIS_SOURCE,
    source_url: IRIS_SOURCE_URL,
    resolved_address: geo.label,
    point: { lat: geo.lat, lon: geo.lon },
    iris,
    note: "code_iris is the 9-character INSEE IRIS code: join it to INSEE's IRIS tables (population, Filosofi income) to add neighbourhood context.",
    caveats: [
      "This boundary layer publishes no income, population or poverty figure — only identity (code, name, type).",
      "INSEE's IRIS socio-demographic tables are not exposed through an anonymous API, so they are left to be joined rather than approximated here.",
    ],
  };
}

/**
 * What is around an address: stations, schools, shops, health, green space —
 * from OpenStreetMap through Overpass. For a buyer this is the criterion no
 * official French dataset answers directly, and it is deliberately its own tool
 * rather than a report section: it is a different question, it costs a heavier
 * upstream call, and it is useful on its own.
 */
export async function nearbyAmenities(args: {
  address?: string;
  lat?: number;
  lon?: number;
  radius_m?: number;
  limit?: number;
}) {
  const { lat, lon, resolved } = await resolvePoint(args);
  const radiusM = Math.min(Math.max(args.radius_m ?? 1000, 100), 5000);
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 5);
  const nearby = await fetchNearby(lat, lon, radiusM);

  return {
    source: OSM_SOURCE,
    source_url: OSM_LICENSE_URL,
    resolved_address: resolved,
    point: { lat, lon },
    radius_m: radiusM,
    // An outage answers every category as unknown (null count), never as an
    // empty neighbourhood: "no school nearby" is a buying decision.
    available: nearby.available,
    categories: nearby.available
      ? nearestByCategory(nearby.elements, lat, lon, limit)
      : unavailableAmenities(),
    unavailable: nearby.unavailable,
    note: nearby.available
      ? "Distances are straight-line (as the crow flies) from the point, in meters, measured to the OSM centre of each object. `count` is how many matching objects the radius query returned — an area such as a park or a station building is one object, placed at its centre — and `nearest` lists the closest. OSM is contributed data, so a missing POI is not proof it does not exist."
      : "Overpass could not be reached, so the surroundings are UNKNOWN — not empty. A null `count` here does not mean nothing is nearby.",
    caveats: [
      "OpenStreetMap is community data (ODbL): coverage is uneven, and a sparse category can reflect missing tags rather than a real absence.",
      "Straight-line distance flatters a walk: rivers, railways and one-way streets add to the real itinerary — check the route before concluding.",
      "Proximity is context, not a price: this states what is around an address, never what the address is worth.",
    ],
  };
}

/** Rent-control reference grid for the area, when the authority publishes one. */
export async function rentControl(args: {
  address: string;
  rooms?: number;
  furnished?: boolean;
  period?: string;
}) {
  const { geo } = await locate(args.address);
  // Lyon keys its grid by IRIS code, so resolve it first; Paris answers geometrically.
  const iris = await irisAtPoint(geo.lat, geo.lon, geo.citycode!).catch(() => null);
  const outcome = await rentControlAtPoint(
    geo.lat,
    geo.lon,
    geo.citycode!,
    { rooms: args.rooms, furnished: args.furnished, period: args.period },
    iris?.code_iris ?? null,
  );

  return {
    query: {
      resolved_address: geo.label,
      insee_code: geo.citycode,
      iris_code: iris?.code_iris ?? null,
      rooms: args.rooms ?? null,
      furnished: args.furnished ?? null,
      period: args.period ?? null,
    },
    ...outcome,
  };
}
