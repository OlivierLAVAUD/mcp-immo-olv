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

/**
 * How close a tram platform has to stand to an already-counted stop of the same
 * mode to be that same stop (measured between their OSM centres). Platform
 * halves of one stop measured at 2 m and 8 m in the field, while distinct tram
 * stops are hundreds of metres apart, so the margin is wide either way.
 */
const SAME_STOP_M = 60;

export type AmenityCategoryKey = "transports" | "education" | "commerces" | "sante" | "loisirs";

/**
 * The transport modes counted separately inside the `transports` category.
 *
 * A single number cannot answer "is there a tram nearby?": a bus stop 30 m away
 * and a tram stop 400 m away both end up in one `count`, and the closest-`limit`
 * list is sorted by distance, so the tram can be pushed out of it. Every mode is
 * therefore answered, with its own count and its own closest POIs.
 */
export type AmenityMode = "train" | "metro" | "tram" | "bus";

interface ModeSpec {
  key: AmenityMode;
  label: string;
}

const MODES: ModeSpec[] = [
  { key: "train", label: "Train / RER / gare" },
  { key: "metro", label: "Métro" },
  { key: "tram", label: "Tramway" },
  { key: "bus", label: "Bus" },
];

/** Transport modes and labels, in the order they are always answered. */
export const AMENITY_MODES = MODES.map(({ key, label }) => ({ key, label }));

interface Selector {
  tag: string;
  values: string[];
  /** Extra exact filters ANDed onto the clause, e.g. a platform that is a tram one. */
  filters?: Array<[string, string]>;
  /**
   * The OSM type reported for a match, when the matched tag value is not the
   * useful one: a `public_transport=platform` match is reported as `tram_stop`,
   * which is what the object actually is to someone reading the answer.
   */
  type?: string;
  /**
   * A platform is a second mapping of a stop that may already be counted, so it
   * is held back and kept only when it adds a stop of its own — see
   * nearestByCategory for the two rules that decide that.
   */
  platform?: boolean;
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
      // A tram stop is usually mapped as a `railway=tram_stop` node *and* as
      // one platform per direction; some stops exist as the platform alone.
      // Those two selectors catch the latter, and the deduplication below keeps
      // them from double-counting the stops the node already answered.
      { tag: "public_transport", values: ["platform"], filters: [["tram", "yes"]], type: "tram_stop", platform: true },
      { tag: "railway", values: ["platform"], filters: [["tram", "yes"]], type: "tram_stop", platform: true },
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

/** One transport mode inside the `transports` category, shaped like its parent. */
export interface AmenityModeResult {
  key: AmenityMode;
  label: string;
  count: number | null;
  nearest_distance_m: number | null;
  nearest: NearbyPoi[];
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
  /** The per-mode breakdown; only the `transports` category has one. */
  modes?: AmenityModeResult[];
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
  const extra = (selector.filters ?? []).map(([tag, value]) => `["${tag}"="${value}"]`).join("");
  return `nwr${filter}${extra}(around:${radiusM},${lat},${lon});`;
}

/**
 * The transport mode of a matched element, read from its tags: the tag says
 * "station", never "train". `subway` is tested first because a metro station
 * is also a station; a tram stop wins over the generic station/halt rule.
 */
export function modeOf(tags: Record<string, string>): AmenityMode | null {
  if (tags.station === "subway") return "metro";
  if (tags.railway === "tram_stop" || tags.railway === "light_rail") return "tram";
  if (tags.station === "tram" || tags.tram === "yes") return "tram";
  if (tags.railway === "station" || tags.railway === "halt") return "train";
  if (tags.highway === "bus_stop" || tags.bus === "yes") return "bus";
  return null;
}

/**
 * One Overpass attempt per mirror, on a short leash. The mirror pair is
 * already the retry: a second mirror exists precisely because the first can
 * struggle, so re-asking a failing mirror three times only delays the failover
 * — and delays the final "unknown" answer when both are down. 12 s sits just
 * above the query's own 10 s budget (`buildAmenityQuery`), enough for Overpass
 * to report its own timeout as a 4xx before the socket is cut. Worst case for
 * the whole tool: 2 mirrors × 12 s ≈ 25 s, against ~150 s before.
 */
const OVERPASS_TIMEOUT_MS = 12_000;

/** The Overpass QL query for a radius around a point. Pure, so it is testable. */
export function buildAmenityQuery(lat: number, lon: number, radiusM: number): string {
  const clauses = CATEGORIES.flatMap((category) =>
    category.selectors.map((selector) => clause(selector, lat, lon, radiusM)),
  );
  return `[out:json][timeout:10];(\n  ${clauses.join("\n  ")}\n);\nout center;`;
}

/**
 * Which category and which OSM type an element belongs to. First match wins:
 * an element carrying several matching tags (a station that is also a shop)
 * counts once, in the first category declared above.
 */
export function classifyElement(
  tags: Record<string, string> | undefined,
): { key: AmenityCategoryKey; type: string; mode: AmenityMode | null; platform: boolean } | null {
  if (!tags) return null;
  for (const category of CATEGORIES) {
    for (const selector of category.selectors) {
      const value = tags[selector.tag];
      if (value === undefined || !selector.values.includes(value)) continue;
      if ((selector.filters ?? []).some(([tag, wanted]) => tags[tag] !== wanted)) continue;
      return {
        key: category.key,
        type: selector.type ?? value,
        mode: category.key === "transports" ? modeOf(tags) : null,
        platform: selector.platform === true,
      };
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

/** A hit plus the two fields used to fold it, stripped before it is returned. */
interface RawHit extends NearbyPoi {
  mode: AmenityMode | null;
  platform: boolean;
}

const toPoi = ({ mode: _mode, platform: _platform, ...poi }: RawHit): NearbyPoi => poi;

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
    const hits: RawHit[] = [];
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
        mode: classified.mode,
        platform: classified.platform,
      });
    }

    // Tram platforms are kept only when they add a stop nothing else answered:
    // at one stop there is typically a `tram_stop` node *and* one platform per
    // direction, so counting them all would multiply the same stop by three.
    //
    // Two rules, because neither alone suffices. A platform is dropped when a
    // stop *of its own mode* repeats its name — of its own mode, because a bus
    // stop named "Avenue de la Gare" 400 m away says nothing about a tram
    // platform of the same name, and silencing that platform would delete a
    // real tram stop from the answer. The name alone still misses the platform
    // named after the street it stands on rather than the stop (Montpellier's
    // "Avenue Henri Frenay" is the `Du Guesclin` stop), so a platform standing
    // within SAME_STOP_M of a stop of its own mode is dropped too. And an
    // unnamed platform is left out for the reason an element with no point is:
    // it cannot be attributed to any stop.
    //
    // The primary mapping is folded first, in distance order, so the rule never
    // depends on which of a stop's objects Overpass happened to return first.
    const byDistance = (a: RawHit, b: RawHit) => a.distance_m - b.distance_m;
    const kept: RawHit[] = [];
    const keptNames: Partial<Record<AmenityMode, Set<string>>> = {};
    const keptPoints: Partial<Record<AmenityMode, Array<{ lat: number; lon: number }>>> = {};

    const keep = (hit: RawHit): void => {
      kept.push(hit);
      if (hit.name && hit.mode) (keptNames[hit.mode] ??= new Set()).add(hit.name.toLowerCase());
      if (hit.mode) (keptPoints[hit.mode] ??= []).push({ lat: hit.lat, lon: hit.lon });
    };

    for (const hit of hits.filter((h) => !h.platform).sort(byDistance)) keep(hit);

    for (const hit of hits.filter((h) => h.platform).sort(byDistance)) {
      if (!hit.name) continue;
      if (hit.mode && keptNames[hit.mode]?.has(hit.name.toLowerCase())) continue;
      const sameStop = hit.mode
        ? (keptPoints[hit.mode] ?? []).some(
            (p) => haversineMeters(hit.lat, hit.lon, p.lat, p.lon) <= SAME_STOP_M,
          )
        : false;
      if (sameStop) continue;
      keep(hit);
    }

    // Keeping the primary stops first was a fold order, not an answer order:
    // the payload stays sorted by distance, so `nearest_distance_m` and the
    // per-mode closest lists keep meaning what they say.
    kept.sort(byDistance);

    const modes =
      category.key === "transports"
        ? MODES.map((mode) => {
            const found = kept.filter((h) => h.mode === mode.key);
            return {
              key: mode.key,
              label: mode.label,
              count: found.length,
              nearest_distance_m: found[0]?.distance_m ?? null,
              nearest: found.slice(0, limit).map(toPoi),
            };
          })
        : undefined;

    return {
      key: category.key,
      label: category.label,
      count: kept.length,
      nearest_distance_m: kept[0]?.distance_m ?? null,
      nearest: kept.slice(0, limit).map(toPoi),
      modes,
    };
  });
}

/**
 * Every category, unanswered: what a source outage has to look like. `count`
 * stays null — an empty list here would claim the neighbourhood is empty. The
 * mode breakdown follows the same rule, so a tram count is never 0 on an outage.
 */
export function unavailableAmenities(): AmenityCategoryResult[] {
  return CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    count: null,
    nearest_distance_m: null,
    nearest: [],
    modes:
      category.key === "transports"
        ? MODES.map((mode) => ({
            key: mode.key,
            label: mode.label,
            count: null,
            nearest_distance_m: null,
            nearest: [],
          }))
        : undefined,
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
      const data = await fetchJson<OverpassResponse>(url, TTL_MS, {
        timeoutMs: OVERPASS_TIMEOUT_MS,
        attempts: 1,
      });
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
