import { afterEach, describe, expect, it, vi } from "vitest";
import { dpeByAddress, dpeByBanId, DPE_DATASETS, DPE_DATASET_ORDER } from "../src/apis/dpe.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// The module cache is keyed by URL, so every test uses a unique id/address.
let counter = 0;
const uniqueBanId = () => `69382_6005_${String(++counter).padStart(5, "0")}`;

describe("DPE registers", () => {
  it("exposes existing and new dwellings, each on its own ADEME dataset", () => {
    expect(DPE_DATASET_ORDER).toEqual(["existant", "neuf"]);
    expect(DPE_DATASETS.existant).toContain("dpe03existant");
    expect(DPE_DATASETS.neuf).toContain("dpe02neuf");
  });

  it("queries dpe03existant by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 0, results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await dpeByBanId(uniqueBanId(), 3);

    expect(String(fetchMock.mock.calls[0][0])).toContain("dpe03existant");
  });

  it("queries dpe02neuf when the new-dwelling register is requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 0, results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await dpeByBanId(uniqueBanId(), 3, "neuf");

    expect(String(fetchMock.mock.calls[0][0])).toContain("dpe02neuf");
  });

  it("keeps the address search scoped to the commune and the chosen register", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 0, results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await dpeByAddress(`Rue Test ${++counter}`, "69382", 5, "neuf");

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain("dpe02neuf");
    expect(url).toContain('code_insee_ban:"69382"');
    expect(url).toContain("adresse_ban");
  });
});