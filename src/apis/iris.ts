import { fetchJson } from "../http.js";

/**
 * IRIS — "Îlots Regroupés pour l'Information Statistique" — is INSEE's
 * infra-communal geography: the smallest official unit below the commune
 * (~2 000 inhabitants), and the level at which French neighbourhood statistics
 * are actually published.
 *
 * Boundaries come from the IGN Géoplateforme WFS layer
 * `STATISTICALUNITS.IRIS:contours_iris` (ADMINEXPRESS, INSEE as producer).
 *
 * Scope warning, stated up front: this layer carries *identity* only — code,
 * name, type, commune. It publishes no income, population or poverty figure.
 * INSEE's IRIS socio-demographic tables (Filosofi, RP infra-communal) are not
 * exposed through an anonymous stable API, so this server returns the IRIS
 * identifier and lets the caller join it to the INSEE table it needs. Saying
 * "the IRIS is X" is useful and true; inventing an income for it would not be.
 */
const WFS = "https://data.geopf.fr/wfs/ows";
const LAYER = "STATISTICALUNITS.IRIS:contours_iris";
export const IRIS_SOURCE = "CONTOURS-IRIS (ADMINEXPRESS), IGN — source INSEE, WFS Géoplateforme";
export const IRIS_SOURCE_URL = "https://geoservices.ign.fr/adminexpress";

export interface IrisArea {
  /** 9-character INSEE IRIS code (commune code + 4 digits). */
  code_iris: string;
  name: string | null;
  /** "H" habitat, "A" activity, "D" miscellaneous, "I" uninhabited, "T"… */
  type: string | null;
  code_insee: string;
  commune: string | null;
}

type Ring = [number, number][];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

/** Ray casting on a single ring. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Outer ring contains the point and no hole does. */
export function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  if (polygon.length === 0 || !pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

export function pointInMultiPolygon(lon: number, lat: number, multi: MultiPolygon): boolean {
  return multi.some((polygon) => pointInPolygon(lon, lat, polygon));
}

export function toMultiPolygon(geometry: unknown): MultiPolygon {
  const g = geometry as { type?: string; coordinates?: unknown } | undefined;
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === "Polygon") return [g.coordinates as Polygon];
  if (g.type === "MultiPolygon") return g.coordinates as MultiPolygon;
  return [];
}

interface IrisFeature {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
}

interface IrisResponse {
  features?: IrisFeature[];
}

/** Pure mapper for the ADMINEXPRESS IRIS attributes. */
export function toIrisArea(properties: Record<string, unknown>, fallbackInsee: string): IrisArea {
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    code_iris: str(properties.code_iris) ?? "",
    name: str(properties.nom_iris),
    type: str(properties.type_iris),
    code_insee: str(properties.code_insee) ?? fallbackInsee,
    commune: str(properties.nom_commune),
  };
}

/**
 * Every IRIS of a commune, cached 24 h by `fetchJson`. One request per commune
 * rather than one per point, which matters for a full report.
 */
export async function irisAreas(
  codeInsee: string,
): Promise<{ area: IrisArea; geometry: MultiPolygon }[]> {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: LAYER,
    OUTPUTFORMAT: "application/json",
    CQL_FILTER: `code_insee='${codeInsee}'`,
  });
  const data = await fetchJson<IrisResponse>(`${WFS}?${params.toString()}`, 24 * 60 * 60_000);
  return (data.features ?? []).map((feature) => ({
    area: toIrisArea(feature.properties ?? {}, codeInsee),
    geometry: toMultiPolygon(feature.geometry),
  }));
}

/** The IRIS containing the point, or null when the point is outside them. */
export async function irisAtPoint(
  lat: number,
  lon: number,
  codeInsee: string,
): Promise<IrisArea | null> {
  const areas = await irisAreas(codeInsee);
  const hit = areas.find((candidate) => pointInMultiPolygon(lon, lat, candidate.geometry));
  return hit?.area ?? null;
}