import { fetchJson } from "../http.js";

/**
 * Cadastral parcels, via the IGN "API Carto" Cadastre module (public, no key).
 *
 * The parcel is the cadastral unit used for property tax: it carries the
 * official *contenance* in m² (the taxed area, which is not the same as the
 * dwelling's habitable surface) and the `idu`, the unique cadastral
 * identifier quoted on deeds and tax notices.
 *
 * The PCI geometry is a tax map: it says nothing about ownership, building
 * rights or the environment of the plot. Those belong to the PLU tool.
 */
const API_CARTO_CADASTRE = "https://apicarto.ign.fr/api/cadastre/parcelle";
export const CADASTRE_SOURCE =
  "Plan cadastral informatisé (PCI), IGN / DGFiP — API Carto (no key)";
export const CADASTRE_SOURCE_URL = "https://apicarto.ign.fr/api/doc/cadastre";

export interface CadastralParcel {
  /** Unique cadastral id, e.g. "69382000AB0062". */
  idu: string;
  section: string | null;
  numero: string | null;
  /** Official taxed area in m² — cadastral contenance, not habitable surface. */
  contenance_m2: number | null;
  code_insee: string | null;
  commune: string | null;
  /** "000" for a normal commune, a commune associée code otherwise. */
  com_abs: string | null;
  /** Approximate plot centre (mean of the boundary vertices). */
  approx_center: { lat: number; lon: number } | null;
  /** [minLon, minLat, maxLon, maxLat] of the parcel. */
  bbox: [number, number, number, number] | null;
}

type Position = [number, number];

/** Flatten any GeoJSON coordinate nesting into a flat list of [lon, lat]. */
export function flattenPositions(coordinates: unknown, out: Position[] = []): Position[] {
  if (!Array.isArray(coordinates)) return out;
  const [first, second] = coordinates;
  if (typeof first === "number" && typeof second === "number") {
    out.push([first, second]);
    return out;
  }
  for (const child of coordinates) flattenPositions(child, out);
  return out;
}

export function geometryExtent(coordinates: unknown): {
  bbox: [number, number, number, number];
  center: { lat: number; lon: number };
} | null {
  const points = flattenPositions(coordinates);
  if (points.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
    sumLon += lon;
    sumLat += lat;
  }
  return {
    bbox: [minLon, minLat, maxLon, maxLat],
    center: { lon: sumLon / points.length, lat: sumLat / points.length },
  };
}

interface ParcelleFeature {
  geometry?: { type: string; coordinates: unknown };
  properties?: {
    idu?: string;
    numero?: string;
    section?: string;
    contenance?: number | string | null;
    code_insee?: string;
    nom_com?: string;
    com_abs?: string;
  };
}

interface ParcelleResponse {
  features?: ParcelleFeature[];
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure mapper, exercised by unit tests without network. */
export function toParcel(feature: ParcelleFeature): CadastralParcel {
  const p = feature.properties ?? {};
  const extent = geometryExtent(feature.geometry?.coordinates);
  return {
    idu: p.idu ?? "",
    section: p.section ?? null,
    numero: p.numero ?? null,
    contenance_m2: numberOrNull(p.contenance),
    code_insee: p.code_insee ?? null,
    commune: p.nom_com ?? null,
    com_abs: p.com_abs ?? null,
    approx_center: extent?.center ?? null,
    bbox: extent?.bbox ?? null,
  };
}

/** Every parcel containing the point (a point can fall on a boundary). */
export async function parcelsAtPoint(lat: number, lon: number): Promise<CadastralParcel[]> {
  const geom = JSON.stringify({ type: "Point", coordinates: [lon, lat] });
  const url = `${API_CARTO_CADASTRE}?geom=${encodeURIComponent(geom)}`;
  const data = await fetchJson<ParcelleResponse>(url, 24 * 60 * 60_000);
  return (data.features ?? []).map(toParcel);
}