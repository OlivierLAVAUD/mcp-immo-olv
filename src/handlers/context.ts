import { dpeByAddress, dpeByBanId, DPE_DATASET_LABELS, DPE_DATASET_ORDER } from "../apis/dpe.js";
import { riskReport } from "../apis/georisques.js";
import { communeByCode, communesByName } from "../apis/communes.js";
import { parcelsAtPoint, CADASTRE_SOURCE, CADASTRE_SOURCE_URL } from "../apis/cadastre.js";
import { zonesAtPoint, prescriptionsAtPoint, GPU_SOURCE, GPU_SOURCE_URL } from "../apis/gpu.js";
import { irisAtPoint, IRIS_SOURCE, IRIS_SOURCE_URL } from "../apis/iris.js";
import { rentControlAtPoint } from "../apis/rent_control.js";
import { reverseGeocode } from "../apis/ban.js";
import { round } from "../util/stats.js";
import { locate, resolvePoint } from "./shared.js";

export async function dpeLookup(args: {
  address: string;
  limit?: number;
  dataset?: "all" | "existant" | "neuf";
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
        diagnostics: res.results.map((record) => ({ ...record, dataset })),
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
    note: "etiquette_dpe = energy label (A best – G worst), etiquette_ges = greenhouse-gas label. conso_5_usages_par_m2_ep is primary energy in kWh/m²/year. `dataset` states which register the row came from.",
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
