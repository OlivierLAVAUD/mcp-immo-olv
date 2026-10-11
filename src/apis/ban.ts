import { fetchJson } from "../http.js";

const BASE = "https://api-adresse.data.gouv.fr";

/**
 * A geocoder answers in well under a second when healthy; when it stalls, every
 * extra second is felt by the caller before a "not found" verdict. Two attempts
 * on an 8 s leash keep a BAN hiccup from dominating a tool call — the default
 * 25 s × 3 is shaped for multi-MB DVF files, not for this.
 */
const BAN_FETCH = { timeoutMs: 8_000, attempts: 2 } as const;

export interface GeocodeResult {
  label: string;
  /** BAN interoperability id, e.g. "75102_6998_00010" (citycode_streetcode_number). */
  banId: string | null;
  housenumber: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  /** INSEE code (arrondissement-level for Paris/Lyon/Marseille). */
  citycode: string | null;
  /** "housenumber" | "street" | "locality" | "municipality" */
  type: string;
  lat: number;
  lon: number;
  score: number;
}

interface BanFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    label: string;
    id?: string;
    housenumber?: string;
    street?: string;
    name?: string;
    postcode?: string;
    city?: string;
    citycode?: string;
    type: string;
    score: number;
  };
}

function toResult(f: BanFeature): GeocodeResult {
  const p = f.properties;
  return {
    label: p.label,
    banId: p.id ?? null,
    housenumber: p.housenumber ?? null,
    street: p.street ?? p.name ?? null,
    postcode: p.postcode ?? null,
    city: p.city ?? null,
    citycode: p.citycode ?? null,
    type: p.type,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    score: p.score,
  };
}

export async function geocode(query: string, limit = 5): Promise<GeocodeResult[]> {
  const url = `${BASE}/search/?q=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await fetchJson<{ features: BanFeature[] }>(url, 5 * 60_000, BAN_FETCH);
  return data.features.map(toResult);
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult[]> {
  const url = `${BASE}/reverse/?lat=${lat}&lon=${lon}`;
  const data = await fetchJson<{ features: BanFeature[] }>(url, 5 * 60_000, BAN_FETCH);
  return data.features.map(toResult);
}

/** Geocode and return the best match, or throw a helpful error. */
export async function geocodeBest(query: string): Promise<GeocodeResult> {
  const results = await geocode(query, 1);
  if (results.length === 0) {
    throw new Error(
      `Address not found in the Base Adresse Nationale: "${query}". Try adding a postcode or city name.`,
    );
  }
  return results[0];
}
