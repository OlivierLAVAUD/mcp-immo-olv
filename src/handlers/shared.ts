import { geocodeBest, GeocodeResult } from "../apis/ban.js";
import {
  availableYears,
  fetchCommunes,
  groupMutations,
  withinRadius,
  Mutation,
} from "../apis/dvf.js";
import { communeCodeAtPoint } from "../apis/communes.js";
import { RENT_YEAR } from "../apis/loyers.js";
import { offsetPoint } from "../util/geo.js";
import { round } from "../util/stats.js";

export const DVF_SOURCE =
  "DVF (Demandes de valeurs foncières), DGFiP / Etalab — actual notarized sales. Alsace-Moselle and Mayotte are not covered.";
export const RENT_SOURCE = `Carte des loyers ${RENT_YEAR}, Ministère du Logement / ANIL — modelled asking rents (charges included).`;

// Guard against DVF data-entry noise (1 € sales, whole-building deeds mistyped...).
export const PRICE_M2_MIN = 200;
export const PRICE_M2_MAX = 40000;

export function validYears(years?: number[]): number[] {
  const all = availableYears();
  if (!years || years.length === 0) return all;
  const valid = years.filter((y) => all.includes(y));
  if (valid.length === 0) {
    throw new Error(`No DVF data for years [${years.join(", ")}]. Available: ${all.join(", ")}.`);
  }
  return valid;
}

export interface LocatedQuery {
  geo: GeocodeResult;
  /** Radius filtering only makes sense when the query resolves to a point. */
  isPoint: boolean;
}

export async function locate(address: string): Promise<LocatedQuery> {
  const geo = await geocodeBest(address);
  if (!geo.citycode) throw new Error(`Could not resolve an INSEE code for "${address}".`);
  return { geo, isPoint: geo.type === "housenumber" || geo.type === "street" || geo.type === "locality" };
}

/**
 * Communes whose territory may intersect a circle around the point: probe 8
 * compass points at the radius. Catches the classic blind spot of
 * commune-file-based DVF tools — addresses near a boundary silently losing
 * half their neighborhood.
 */
async function communesAround(lat: number, lon: number, radiusM: number): Promise<string[]> {
  const probes = await Promise.all(
    [0, 45, 90, 135, 180, 225, 270, 315].map((bearing) => {
      const p = offsetPoint(lat, lon, bearing, radiusM);
      return communeCodeAtPoint(p.lat, p.lon);
    }),
  );
  return [...new Set(probes.filter((c): c is string => c !== null))];
}

export async function loadMutations(
  located: LocatedQuery,
  radiusM: number,
  years: number[],
): Promise<{ mutations: Mutation[]; communes: string[] }> {
  const { geo, isPoint } = located;
  let communes = [geo.citycode!];
  if (isPoint) {
    const around = await communesAround(geo.lat, geo.lon, radiusM);
    communes = [...new Set([geo.citycode!, ...around])];
  }
  const rows = await fetchCommunes(communes, years);
  return { mutations: groupMutations(rows), communes };
}

export function saleView(m: Mutation) {
  return {
    date: m.date,
    nature: m.nature,
    price_eur: m.price,
    addresses: m.addresses,
    dwellings: m.dwellings,
    other_locals: m.otherLocals.length > 0 ? m.otherLocals : undefined,
    land_surface_m2: m.landSurface,
    price_per_m2: round(m.priceM2, 0),
  };
}

export function cleanPriceM2(m: Mutation): boolean {
  return (
    m.nature === "Vente" &&
    m.priceM2 !== null &&
    m.priceM2 >= PRICE_M2_MIN &&
    m.priceM2 <= PRICE_M2_MAX
  );
}

/**
 * Resolve a lat/lon point, geocoding the address when coordinates are absent.
 * Shared by every enrichment tool that accepts "address or lat/lon".
 */
export async function resolvePoint(
  args: { address?: string; lat?: number; lon?: number },
): Promise<{ lat: number; lon: number; resolved: string | null }> {
  let { lat, lon } = args;
  let resolved: string | null = null;
  if ((lat === undefined || lon === undefined) && args.address) {
    const { geo } = await locate(args.address);
    lat = geo.lat;
    lon = geo.lon;
    resolved = geo.label;
  }
  if (lat === undefined || lon === undefined) {
    throw new Error("Provide either an address or both lat and lon.");
  }
  return { lat, lon, resolved };
}
