import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDiskCache, writeDiskCache } from "../src/util/disk-cache.js";
import {
  clearParsedDvfCacheForTests,
  DVF_PARSED_CACHE_TTL_MS,
  fetchCommuneYear,
} from "../src/apis/dvf.js";

const CSV = [
  "id_mutation,date_mutation,nature_mutation,valeur_fonciere,adresse_numero,adresse_nom_voie,code_postal,code_commune,nom_commune,type_local,surface_reelle_bati,nombre_pieces_principales,surface_terrain,longitude,latitude",
  "m1,2024-01-01,Vente,100000,1,RUE TEST,01000,01001,Test,Maison,50,3,,5.1,46.2",
].join("\n");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "immo-disk-cache-"));
  process.env.IMMO_CACHE_DIR = dir;
  clearParsedDvfCacheForTests();
});

afterEach(() => {
  delete process.env.IMMO_CACHE_DIR;
  clearParsedDvfCacheForTests();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/**
 * DVF writes to disk are fire-and-forget on purpose, so a tool response never
 * waits on a slow spindle. A test that "restarts" right after the first call
 * must therefore wait for the spill itself — otherwise it races the write and
 * flaps. Any cache file will do: the folder starts empty.
 */
async function waitForSpill(): Promise<void> {
  const spilled = (): boolean => {
    try {
      return readdirSync(dir).some((sub) => {
        if (sub.startsWith(".")) return false;
        try {
          return readdirSync(join(dir, sub)).some((f) => f.endsWith(".json"));
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };
  await vi.waitFor(() => expect(spilled()).toBe(true));
}

describe("disk cache", () => {
  it("round-trips a payload, with its TTL", async () => {
    await writeDiskCache("unit", "a", { rows: 3 }, DVF_PARSED_CACHE_TTL_MS);
    expect(await readDiskCache<{ rows: number }>("unit", "a", DVF_PARSED_CACHE_TTL_MS)).toEqual({ rows: 3 });
  });

  it("treats an entry past its TTL as a miss", async () => {
    await writeDiskCache("unit", "old", [1], DVF_PARSED_CACHE_TTL_MS);
    // A negative TTL is already over the moment it is read — deterministic,
    // no clock to race against.
    expect(await readDiskCache("unit", "old", -1)).toBeNull();
  });

  it("treats a corrupt file as a miss, never as an error", async () => {
    mkdirSync(join(dir, "unit"), { recursive: true });
    writeFileSync(join(dir, "unit", "broken.json"), "not json {");
    expect(await readDiskCache("unit", "broken", DVF_PARSED_CACHE_TTL_MS)).toBeNull();
  });

  it("does nothing at all when the directory is unset or unwritable", async () => {
    delete process.env.IMMO_CACHE_DIR;
    await writeDiskCache("nowhere", "a", [1], 1000); // must not throw
    expect(await readDiskCache("nowhere", "a", 1000)).toBeNull();

    // A plain file where the directory should be: mkdir and write both fail,
    // silently.
    process.env.IMMO_CACHE_DIR = join(dir, "afile");
    writeFileSync(process.env.IMMO_CACHE_DIR, "x");
    await writeDiskCache("blocked", "a", [1], 1000);
    expect(await readDiskCache("blocked", "a", 1000)).toBeNull();
  });

  it("keeps caller input inside the cache folder", async () => {
    // "../evil" sanitizes to a literal subfolder name inside the cache dir,
    // not a traversal: slashes become underscores, dots stay put as ordinary
    // characters of an odd-looking but harmless name.
    await writeDiskCache("../evil", "../../evil", [1], 1000);
    expect(existsSync(join(dir, ".._evil"))).toBe(true);
    expect(() => statSync(join(dir, "..", "evil.json"))).toThrow();
  });
});

describe("DVF second-level disk cache", () => {
  it("hydrates a cold process from disk without touching the network", async () => {
    // First call: network fills memory and spills to disk.
    const net = vi.fn().mockResolvedValue(new Response(CSV, { status: 200 }));
    vi.stubGlobal("fetch", net);
    const first = await fetchCommuneYear("01001", 2024);
    expect(first).toHaveLength(1);
    expect(net).toHaveBeenCalledTimes(1);
    await waitForSpill();

    // Simulate a restart: empty memory, dead network — and the disk answers.
    clearParsedDvfCacheForTests();
    const dead = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", dead);
    const second = await fetchCommuneYear("01001", 2024);

    expect(dead).not.toHaveBeenCalled();
    expect(second[0].idMutation).toBe("m1");
  });

  it("remembers a missing commune-year instead of 404ing it again", async () => {
    const gone = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", gone);
    expect(await fetchCommuneYear("01999", 2024)).toEqual([]);
    expect(gone).toHaveBeenCalledTimes(1);
    await waitForSpill();

    clearParsedDvfCacheForTests();
    const dead = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", dead);
    expect(await fetchCommuneYear("01999", 2024)).toEqual([]);
    expect(dead).not.toHaveBeenCalled();
  });

  it("changes nothing when the directory is unset (process-local only)", async () => {
    delete process.env.IMMO_CACHE_DIR;
    // A fresh Response per call: a body can only be read once.
    const net = vi.fn().mockImplementation(() => Promise.resolve(new Response(CSV, { status: 200 })));
    vi.stubGlobal("fetch", net);

    await fetchCommuneYear("01001", 2024);
    clearParsedDvfCacheForTests();
    // No disk, no memory: the network is asked again.
    await fetchCommuneYear("01001", 2024);
    expect(net).toHaveBeenCalledTimes(2);
  });
});