import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AMENITY_CATEGORIES,
  AMENITY_MODES,
  buildAmenityQuery,
  classifyElement,
  elementPoint,
  fetchNearby,
  modeOf,
  nearestByCategory,
  unavailableAmenities,
  type OverpassElement,
} from "../src/apis/overpass.js";
import { createServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The module cache is keyed by URL: every test asks from its own point. */
const uniquePoint = () => ({ lat: 45 + Math.random() * 0.1, lon: 4 + Math.random() * 0.1 });

function poi(over: Partial<OverpassElement> & { tags?: Record<string, string> }): OverpassElement {
  return { type: "node", id: Math.floor(Math.random() * 1e9), lat: 45.76, lon: 4.83, ...over };
}

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------------------ the query

describe("Overpass query", () => {
  it("asks one clause per selector, exact matches where a single value suffices", () => {
    const query = buildAmenityQuery(45.764, 4.8357, 800);

    expect(query.startsWith("[out:json][timeout:10];")).toBe(true);
    expect(query.trimEnd().endsWith("out center;")).toBe(true);

    // One clause per selector in the category table (5 transports + 1 education
    // + 2 commerces + 1 santé + 1 loisirs), so a category cannot be declared in
    // the table and silently left out of the query. Adding a category is meant
    // to force this number, and the assertions below, to be updated.
    expect(query.match(/nwr\[/g)).toHaveLength(10);
    expect(AMENITY_CATEGORIES.map((c) => c.key)).toEqual([
      "transports",
      "education",
      "commerces",
      "sante",
      "loisirs",
    ]);

    // Multi-value tags are regex alternations; single-value tags are equality.
    expect(query).toContain('["railway"~"^(station|halt|tram_stop)$"](around:800,45.764,4.8357)');
    expect(query).toContain('["station"="subway"](around:800,45.764,4.8357)');
    expect(query).toContain('["highway"="bus_stop"](around:800,45.764,4.8357)');
    // Tram stops mapped as a platform alone are queried too, restricted to the
    // platforms tagged as tram ones so a bus platform is never swept in.
    expect(query).toContain('["public_transport"="platform"]["tram"="yes"](around:800,45.764,4.8357)');
    expect(query).toContain('["railway"="platform"]["tram"="yes"](around:800,45.764,4.8357)');
    expect(query).toContain('["amenity"~"^(school|kindergarten|college|university)$"](around:800,45.764,4.8357)');
    expect(query).toContain('["shop"~"^(supermarket|convenience|bakery|butcher|greengrocer)$"](around:800,45.764,4.8357)');
    expect(query).toContain('["amenity"="marketplace"](around:800,45.764,4.8357)');
    expect(query).toContain('["amenity"~"^(pharmacy|doctors|dentist|hospital|clinic)$"](around:800,45.764,4.8357)');
    expect(query).toContain('["leisure"~"^(park|garden|playground|sports_centre)$"](around:800,45.764,4.8357)');
  });
});

// ------------------------------------------------------------- classification

describe("classifyElement", () => {
  it("maps OSM tags onto the five answered categories", () => {
    expect(classifyElement({ railway: "tram_stop" })).toEqual({ key: "transports", type: "tram_stop", mode: "tram", platform: false });
    expect(classifyElement({ station: "subway" })).toEqual({ key: "transports", type: "subway", mode: "metro", platform: false });
    expect(classifyElement({ highway: "bus_stop" })).toEqual({ key: "transports", type: "bus_stop", mode: "bus", platform: false });
    expect(classifyElement({ amenity: "university" })).toEqual({ key: "education", type: "university", mode: null, platform: false });
    expect(classifyElement({ shop: "bakery" })).toEqual({ key: "commerces", type: "bakery", mode: null, platform: false });
    expect(classifyElement({ amenity: "marketplace" })).toEqual({ key: "commerces", type: "marketplace", mode: null, platform: false });
    expect(classifyElement({ amenity: "pharmacy" })).toEqual({ key: "sante", type: "pharmacy", mode: null, platform: false });
    expect(classifyElement({ leisure: "park" })).toEqual({ key: "loisirs", type: "park", mode: null, platform: false });
  });

  it("reads a tram stop mapped as a platform, but never a bus platform", () => {
    // Reported as what it is to a reader — a tram stop — and flagged as a
    // platform so the fold can hold it back if the stop is already counted.
    expect(classifyElement({ public_transport: "platform", railway: "platform", tram: "yes" })).toEqual({
      key: "transports",
      type: "tram_stop",
      mode: "tram",
      platform: true,
    });

    expect(classifyElement({ public_transport: "platform" })).toBeNull();
    expect(classifyElement({ public_transport: "platform", bus: "yes" })).toBeNull();
    expect(classifyElement({ public_transport: "platform", tram: "no" })).toBeNull();
  });

  it("reads the transport mode off the tags, subway before station", () => {
    expect(modeOf({ railway: "station" })).toBe("train");
    expect(modeOf({ railway: "halt" })).toBe("train");
    expect(modeOf({ railway: "station", station: "subway" })).toBe("metro");
    expect(modeOf({ railway: "station", station: "tram" })).toBe("tram");
    expect(modeOf({ railway: "light_rail" })).toBe("tram");
    expect(modeOf({ public_transport: "platform", tram: "yes" })).toBe("tram");
    expect(modeOf({ highway: "bus_stop" })).toBe("bus");
    expect(modeOf({ shop: "bakery" })).toBeNull();
  });

  it("ignores anything outside the answered categories, so nothing is invented", () => {
    expect(classifyElement({ amenity: "restaurant" })).toBeNull();
    expect(classifyElement({ shop: "jewelry" })).toBeNull();
    expect(classifyElement({ leisure: "pitch" })).toBeNull();
    expect(classifyElement({})).toBeNull();
    expect(classifyElement(undefined)).toBeNull();
  });

  it("counts a multi-tagged element once, in the first matching category", () => {
    expect(classifyElement({ railway: "station", shop: "supermarket" })).toEqual({
      key: "transports",
      type: "station",
      mode: "train",
      platform: false,
    });
  });

  it("reads nodes on lat/lon and areas on their centre", () => {
    expect(elementPoint(poi({ lat: 45.1, lon: 4.2 }))).toEqual({ lat: 45.1, lon: 4.2 });
    expect(elementPoint({ type: "way", id: 1, center: { lat: 45.3, lon: 4.4 } })).toEqual({ lat: 45.3, lon: 4.4 });
    expect(elementPoint({ type: "relation", id: 2 })).toBeNull();
  });
});

// ------------------------------------------------------------------ distances

describe("nearestByCategory", () => {
  const LAT = 45.764;
  const LON = 4.8357;

  it("counts every match but lists only the closest ones", () => {
    const elements = [
      poi({ lat: 45.764, lon: 4.8357, tags: { amenity: "pharmacy", name: "Ici" } }),
      poi({ lat: 45.764 + 0.001, lon: 4.8357, tags: { amenity: "pharmacy" } }),
      poi({ lat: 45.764 + 0.005, lon: 4.8357, tags: { amenity: "pharmacy" } }),
    ];

    const [sante] = nearestByCategory(elements, LAT, LON, 2).filter((c) => c.key === "sante");

    expect(sante.count).toBe(3);
    expect(sante.nearest).toHaveLength(2);
    expect(sante.nearest[0]).toMatchObject({ name: "Ici", type: "pharmacy", distance_m: 0 });
    expect(sante.nearest[1].distance_m).toBeGreaterThan(0);
    expect(sante.nearest_distance_m).toBe(0);
    // Sorted ascending: 0 m, ~111 m.
    expect(sante.nearest.map((p) => p.distance_m)).toEqual([...sante.nearest.map((p) => p.distance_m)].sort((a, b) => a - b));
  });

  it("answers every category, and separates \"none here\" from \"unknown\"", () => {
    const categories = nearestByCategory([poi({ tags: { leisure: "park" } })], LAT, LON, 3);

    expect(categories.map((c) => c.key)).toEqual(["transports", "education", "commerces", "sante", "loisirs"]);
    const transports = categories.find((c) => c.key === "transports")!;
    // Nothing around is a real answer: 0, not null.
    expect(transports).toMatchObject({ count: 0, nearest_distance_m: null, nearest: [] });
    expect(categories.find((c) => c.key === "loisirs")!.count).toBe(1);
    // The mode breakdown answers too, and only transports has one.
    expect(transports.modes!.map((m) => m.key)).toEqual(["train", "metro", "tram", "bus"]);
    expect(transports.modes!.every((m) => m.count === 0 && m.nearest.length === 0)).toBe(true);
    expect(AMENITY_MODES.map((m) => m.key)).toEqual(transports.modes!.map((m) => m.key));
    expect(categories.find((c) => c.key === "loisirs")!.modes).toBeUndefined();

    // What a source outage must look like instead: null, never 0 — modes too,
    // or an outage would read as "no tram here".
    const unknown = unavailableAmenities();
    expect(unknown.map((c) => c.key)).toEqual(categories.map((c) => c.key));
    expect(unknown.every((c) => c.count === null && c.nearest_distance_m === null && c.nearest.length === 0)).toBe(true);
    const unknownTransports = unknown.find((c) => c.key === "transports")!;
    expect(unknownTransports.modes!.every((m) => m.count === null && m.nearest_distance_m === null && m.nearest.length === 0)).toBe(true);
  });

  it("counts each transport mode separately, so a tram is not drowned by buses", () => {
    const elements = [
      poi({ lat: LAT, lon: LON, tags: { highway: "bus_stop", name: "Bus 1" } }),
      poi({ lat: LAT + 0.0005, lon: LON, tags: { highway: "bus_stop", name: "Bus 2" } }),
      poi({ lat: LAT + 0.001, lon: LON, tags: { station: "subway", name: "Métro" } }),
      poi({ lat: LAT + 0.002, lon: LON, tags: { railway: "station", name: "Gare" } }),
      poi({ lat: LAT + 0.004, lon: LON, tags: { railway: "tram_stop", name: "Tram" } }),
    ];

    const transports = nearestByCategory(elements, LAT, LON, 2).find((c) => c.key === "transports")!;
    const modes = Object.fromEntries(transports.modes!.map((m) => [m.key, m]));

    expect(transports.count).toBe(5);
    expect(modes.bus.count).toBe(2);
    expect(modes.metro.count).toBe(1);
    expect(modes.train.count).toBe(1);
    expect(modes.tram.count).toBe(1);
    // The closest tram is listed even though the mixed list stops at `limit`.
    expect(modes.tram.nearest[0]).toMatchObject({ name: "Tram", type: "tram_stop" });
    expect(modes.tram.nearest_distance_m).toBe(modes.tram.nearest[0].distance_m);
    expect(modes.bus.nearest.map((p) => p.name)).toEqual(["Bus 1", "Bus 2"]);
    // The mode POIs carry no fold fields.
    expect(Object.keys(modes.tram.nearest[0]).sort()).toEqual(["distance_m", "lat", "lon", "name", "osm", "type"]);
  });

  it("counts a tram platform only when it adds a stop nothing else answered", () => {
    // ~5 m and ~22 m north of the point; degrees of latitude are ~111 km.
    const nearby = (m: number) => LAT + m / 111_000;
    const platform = (name: string | undefined, dLat = 0) =>
      poi({
        lat: nearby(dLat),
        lon: LON,
        tags: {
          public_transport: "platform",
          railway: "platform",
          tram: "yes",
          ...(name ? { name } : {}),
        },
      });
    const elements: OverpassElement[] = [
      poi({ lat: LAT, lon: LON, tags: { railway: "tram_stop", name: "Comédie" } }),
      // The two platforms of the same stop: same name, so they must not multiply it.
      platform("Comédie"),
      platform("Comédie"),
      // Named after the street it stands on, not the stop: Montpellier's "Avenue
      // Henri Frenay" is the `Du Guesclin` stop, 7 m from its tram_stop nodes.
      // Only proximity catches this one.
      platform("Avenue Henri Frenay", 5),
      // An unnamed platform cannot be attributed to any stop.
      platform(undefined),
      // A stop mapped as a named platform only, far from anything counted: the
      // one to recover, with its two directions collapsed by name.
      platform("Observatoire", 222),
      platform("Observatoire", 223),
      // A tram platform standing on a *bus* stop is its own stop, not a repeat.
      platform("Tram Ici", 300),
    ];
    elements.push(poi({ lat: nearby(303), lon: LON, tags: { highway: "bus_stop", name: "Bus Là" } }));

    const transports = nearestByCategory(elements, LAT, LON, 5).find((c) => c.key === "transports")!;

    expect(transports.count).toBe(4);
    expect(transports.nearest.map((p) => p.name)).toEqual([
      "Comédie",
      "Observatoire",
      "Tram Ici",
      "Bus Là",
    ]);
    expect(transports.nearest.every((p) => p.type === "tram_stop" || p.type === "bus_stop")).toBe(true);
    expect(transports.modes!.find((m) => m.key === "tram")!.count).toBe(3);
    expect(transports.modes!.find((m) => m.key === "bus")!.count).toBe(1);
  });

  it("keeps a platform that shares its name with a stop of another mode", () => {
    // A bus stop and a tram platform both take their name from the street they
    // stand on, 400 m apart. They are two different stops: the name rule must
    // not silence the platform because a *bus* answers to the same name — that
    // platform is the only mapping of its tram stop.
    const elements: OverpassElement[] = [
      poi({ lat: LAT, lon: LON, tags: { highway: "bus_stop", name: "Avenue de la Gare" } }),
      poi({
        lat: LAT + 0.0036,
        lon: LON,
        tags: { public_transport: "platform", railway: "platform", tram: "yes", name: "Avenue de la Gare" },
      }),
    ];

    const transports = nearestByCategory(elements, LAT, LON, 5).find((c) => c.key === "transports")!;

    expect(transports.count).toBe(2);
    const modes = Object.fromEntries(transports.modes!.map((m) => [m.key, m]));
    expect(modes.bus.count).toBe(1);
    expect(modes.tram.count).toBe(1);
    expect(modes.tram.nearest[0]).toMatchObject({ name: "Avenue de la Gare", type: "tram_stop" });
  });

  it("leaves out an element it cannot place, rather than counting it at 0 m", () => {
    const elements = [
      poi({ lat: 45.764, lon: 4.8357, tags: { amenity: "pharmacy" } }),
      { type: "relation", id: 9, tags: { amenity: "hospital" } } as OverpassElement,
    ];

    const sante = nearestByCategory(elements, LAT, LON, 3).find((c) => c.key === "sante")!;

    expect(sante.count).toBe(1);
    expect(sante.nearest[0].type).toBe("pharmacy");
  });

  it("names the OSM object, so a claim can be checked at the source", () => {
    const element: OverpassElement = {
      type: "node",
      id: 4242,
      lat: LAT,
      lon: LON,
      tags: { highway: "bus_stop", name: "Arrêt Test" },
    };

    const transports = nearestByCategory([element], LAT, LON, 1).find((c) => c.key === "transports")!;

    expect(transports.nearest[0]).toMatchObject({ name: "Arrêt Test", type: "bus_stop", osm: "node/4242" });
  });
});

// ------------------------------------------------------------ the HTTP layer

describe("fetchNearby", () => {
  it("falls back to the next mirror when one answers with a server error", async () => {
    const fetchMock = vi.fn(async (rawUrl: string) => {
      const url = decodeURIComponent(String(rawUrl));
      if (url.includes("overpass.openstreetmap.fr")) return jsonResponse({}, 503);
      return jsonResponse({
        elements: [{ type: "node", id: 1, lat: 45.764, lon: 4.8357, tags: { amenity: "pharmacy" } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { lat, lon } = uniquePoint();
    const result = await fetchNearby(lat, lon, 500);

    expect(result.available).toBe(true);
    expect(result.elements).toHaveLength(1);
    const hosts = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(hosts.some((h) => h.includes("openstreetmap.fr"))).toBe(true);
    expect(hosts.some((h) => h.includes("overpass-api.de"))).toBe(true);
  });

  it("stays loud about a 4xx: a bad query is our bug, not a source outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 400)));

    const { lat, lon } = uniquePoint();
    await expect(fetchNearby(lat, lon, 500)).rejects.toThrow(/HTTP 400/);
  });
});

// -------------------------------------------------------- through the server

async function connect() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "amenities-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return { server, client };
}

describe("nearby_amenities through the MCP server", () => {
  it("answers with a payload its declared output schema accepts", async () => {
    // The point is injected (no geocoding) and unique, and the mocked POIs are
    // built around it, so distances are exact and no neighbouring test can hit
    // this URL in the response cache.
    const { lat, lon } = uniquePoint();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (rawUrl: string) => {
        const url = decodeURIComponent(String(rawUrl));
        if (url.includes("/interpreter")) {
          return jsonResponse({
            elements: [
              { type: "node", id: 1, lat, lon, tags: { railway: "tram_stop", name: "Saxe" } },
              { type: "way", id: 2, center: { lat: lat + 0.001, lon }, tags: { leisure: "park" } },
              { type: "node", id: 3, lat, lon, tags: { amenity: "restaurant" } },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { server, client } = await connect();
    const res = await client.callTool({ name: "nearby_amenities", arguments: { lat, lon, radius_m: 600 } });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.available).toBe(true);
    expect(structured.radius_m).toBe(600);
    expect(structured.categories).toHaveLength(5);
    const transports = structured.categories.find((c: any) => c.key === "transports");
    expect(transports.count).toBe(1);
    expect(transports.nearest[0].name).toBe("Saxe");
    expect(transports.nearest[0].distance_m).toBe(0);
    // The tram stop is answered as a tram, in its own mode count.
    expect(transports.modes.find((m: any) => m.key === "tram").count).toBe(1);
    expect(transports.modes.reduce((n: number, m: any) => n + m.count, 0)).toBe(1);
    // The unmatched restaurant is not smuggled into any category.
    expect(structured.categories.reduce((n: number, c: any) => n + c.count, 0)).toBe(2);
    expect(structured.unavailable).toBeUndefined();

    await server.close();
  });

  it("reports an unreachable Overpass as unknown counts, never as an empty neighbourhood", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const { server, client } = await connect();
    const { lat, lon } = uniquePoint();
    const res = await client.callTool({ name: "nearby_amenities", arguments: { lat, lon } });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.available).toBe(false);
    expect(structured.categories).toHaveLength(5);
    expect(structured.categories.every((c: any) => c.count === null && c.nearest.length === 0)).toBe(true);
    // A tram count of 0 on an outage would claim "no tram here".
    const transports = structured.categories.find((c: any) => c.key === "transports");
    expect(transports.modes.every((m: any) => m.count === null && m.nearest.length === 0)).toBe(true);
    expect(structured.unavailable.reason).toMatch(/HTTP 503/);
    expect(structured.note).toContain("UNKNOWN");

    await server.close();
  });
});
