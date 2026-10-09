import { fetchJson, HttpError, isRetryable } from "../http.js";
import { haversineMeters } from "../util/geo.js";

/**
 * Nearby amenities from OpenStreetMap, through the Overpass API.
 *
 * Why OSM: it is the only anonymous, nationwide source that actually answers
 * "what is within 500 m of this address" for a *useful* set of categories —
 * stations, schools, shops, health. IGN BD TOPO carries the official transport
 * and school layers but not a comparably complete POI set, and its extra layers
 * would have to be joined by hand for every category. OSM data is ODbL: fine to
 * query live and to attribute, which this module does in every payload.
 *
 * Two rules, both mirroring the Géorisques integration:
 *
 *  1. **A source that did not answer is reported as unknown**, never as "there
 *     is nothing around". An empty amenities list reads as "quiet residential
 *     street", which is exactly the misreading this must not produce.
 *  2. **Query shape is derived from one table**, so the Overpass query and the
 *     classifier that reads the answer can never drift apart: adding a category
 *     here adds its query clause and its classification in the same edit.
 */

export const OSM_SOURCE =
  "OpenStreetMap, via l'API Overpass — données © les contributeurs OpenStreetMap (ODbL)";
export const OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright";
/** Public entry point to check by hand when every mirror is down. */
export const OSM_PORTAL = "https://www.openstreetmap.org/";

/**
 * Mirrors, tried in order. The main instance (overpass-api.de) answers under
 * load with HTTP 504 on a multi-category query; the French instance is both
 * faster and closer to the data's audience, so it goes first. A dead mirror
 * must not take the tool down while another one answers.
 */
export const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

/** How long an Overpass answer stays valid: POIs move slowly. */
const TTL_MS = 6 * 60 * 60_000;

export type AmenityCategoryKey = "transports" | "education" | "commerces" | "sante" | "loisirs";

interface Selector {
  tag: string;
  values: string[];
}

interface CategorySpec {
  key: AmenityCategoryKey;
  label: string;
  selectors: Selector[];
}

const CATEGORIES: CategorySpec[] = [
  {
    key: "transports",
    label: "Transports (gare, métro, tram, arrêt de bus)",
    selectors: [
      { tag: "railway", values: ["station", "halt", "tram_stop"] },
      { tag: "station", values: ["subway"] },
      { tag: "highway", values: ["bus_stop"] },
    ],
  },
  {
    key: "education",
    label: "Écoles et enseignement",
    selectors: [
      { tag: "amenity", values: ["school", "kindergarten", "college", "university"] },
    ],
  },
  {
    key: "commerces",
    label: "Commerces de proximité",
    selectors: [
      { tag: "shop", values: ["supermarket", "convenience", "bakery", "butcher", "greengrocer"] },
      { tag: "amenity", values: ["marketplace"] },
    ],
  },
  {
    key: "sante",
    label: "Santé (pharmacie, médecin, hôpital)",
    selectors: [{ tag: "amenity", values: ["pharmacy", "doctors", "dentist", "hospital", "clinic"] }],
  },
  {
    key: "loisirs",
    label: "Espaces verts et sport",
    selectors: [
      { tag: "leisure", values: ["park", "garden", "playground", "sports_centre"] },
    ],
  },
];

/** Category keys and labels, in the order they are always answered. */
export const AMENITY_CATEGORIES = CATEGORIES.map(({ key, label }) => ({ key, label }));

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export interface NearbyPoi {
  name: string | null;
  /** The OSM tag value that matched, e.g. "tram_stop", "pharmacy", "university". */
  type: string;
  distance_m: number;
  lat: number;
  lon: number;
  /** "node/123456" — the OSM object, so a claim can be checked at the source. */
  osm: string;
}

export interface AmenityCategoryResult {
  key: AmenityCategoryKey;
  label: string;
  /** Number of matching POIs within the radius; null when the source is unreachable. */
  count: number | null;
  /** null when the source is unreachable — never 0, which would read as "right here". */
  nearest_distance_m: number | null;
  /** Up to `limit` closest POIs; empty when the source is unreachable. */
  nearest: NearbyPoi[];
}

export interface NearbyAmenities {
  available: boolean;
  elements: OverpassElement[];
  /** Set only when `available` is false. */
  unavailable?: { reason: string; portal_url: string };
}

/** One Overpass clause per selector; single values are exact matches, not regex. */
function clause(selector: Selector, lat: number, lon: number, radiusM: number): string {
  const filter =
    selector.values.length === 1
      ? `["${selector.tag}"="${selector.values[0]}"]`
      : `["${selector.tag}"~"^(${selector.values.join("|")})$"]`;
  return `nwr${filter}(around:${radiusM},${lat},${lon});`;
}

/** The Overpass QL query for a radius around a point. Pure, so it is testable. */
export function buildAmenityQuery(lat: number, lon: number, radiusM: number): string {
  const clauses = CATEGORIES.flatMap((category) =>
    category.selectors.map((selector) => clause(selector, lat, lon, radiusM)),
  );
  return `[out:json][timeout:25];(\n  ${clauses.join("\n  ")}\n);\nout center;`;
}

/**
 * Which category and which OSM type an element belongs to. First match wins:
 * an element carrying several matching tags (a station that is also a shop)
 * counts once, in the first category declared above.
 */
export function classifyElement(
  tags: Record<string, string> | undefined,
): { key: AmenityCategoryKey; type: string } | null {
  if (!tags) return null;
  for (const category of CATEGORIES) {
    for (const selector of category.selectors) {
      const value = tags[selector.tag];
      if (value !== undefined && selector.values.includes(value)) {
        return { key: category.key, type: value };
      }
    }
  }
  return null;
}

/** Overpass puts nodes on `lat`/`lon` and ways/relations on `center`. */
export function elementPoint(element: OverpassElement): { lat: number; lon: number } | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center) return { lat: element.center.lat, lon: element.center.lon };
  return null;
}

/**
 * Fold raw elements into one entry per category: the total count inside the
 * radius, and the closest `limit` POIs. Categories with nothing around still
 * answer, with `count: 0` — the difference between "none" and "unknown" is the
 * whole point, so both states are explicit and distinct.
 */
export function nearestByCategory(
  elements: OverpassElement[],
  lat: number,
  lon: number,
  limit: number,
): AmenityCategoryResult[] {
  return CATEGORIES.map((category) => {
    const hits: NearbyPoi[] = [];
    for (const element of elements) {
      const classified = classifyElement(element.tags);
      if (!classified || classified.key !== category.key) continue;
      const point = elementPoint(element);
      // An element with no usable point cannot be placed or ranked; it is left
      // out of the count rather than counted at distance 0.
      if (!point) continue;
      hits.push({
        name: element.tags?.name ?? null,
        type: classified.type,
        distance_m: Math.round(haversineMeters(lat, lon, point.lat, point.lon)),
        lat: point.lat,
        lon: point.lon,
        osm: `${element.type}/${element.id}`,
      });
    }
    hits.sort((a, b) => a.distance_m - b.distance_m);
    return {
      key: category.key,
      label: category.label,
      count: hits.length,
      nearest_distance_m: hits[0]?.distance_m ?? null,
      nearest: hits.slice(0, limit),
    };
  });
}

/**
 * Every category, unanswered: what a source outage has to look like. `count`
 * stays null — an empty list here would claim the neighbourhood is empty.
 */
export function unavailableAmenities(): AmenityCategoryResult[] {
  return CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    count: null,
    nearest_distance_m: null,
    nearest: [],
  }));
}

function describeFailure(e: unknown): string {
  if (e instanceof HttpError) return `Overpass API returned HTTP ${e.status}`;
  return `Overpass API unreachable: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Raw POIs around a point. Tries each mirror in turn; a mirror that fails with
 * a retryable error (5xx, rate limit, dead socket) hands over to the next one,
 * while a 4xx — our own malformed query — is thrown instead of hidden.
 */
export async function fetchNearby(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<NearbyAmenities> {
  const query = buildAmenityQuery(lat, lon, radiusM);
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const url = `${endpoint}?data=${encodeURIComponent(query)}`;
    try {
      const data = await fetchJson<OverpassResponse>(url, TTL_MS);
      return { available: true, elements: data.elements ?? [] };
    } catch (e) {
      if (!isRetryable(e)) throw e;
      lastError = e;
    }
  }

  return {
    available: false,
    elements: [],
    unavailable: { reason: describeFailure(lastError), portal_url: OSM_PORTAL },
  };
}
