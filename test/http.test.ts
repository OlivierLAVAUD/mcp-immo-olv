import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, HttpError } from "../src/http.js";

// The module-level cache persists across tests, so every test uses a unique URL.
let counter = 0;
const uniqueUrl = () => `https://example.test/resource-${++counter}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson caching", () => {
  it("serves a repeated call from cache without a second request", async () => {
    const url = uniqueUrl();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchJson(url)).toEqual({ ok: 1 });
    expect(await fetchJson(url)).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has expired", async () => {
    const url = uniqueUrl();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ v: 1 }))
      .mockResolvedValueOnce(jsonResponse({ v: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchJson(url, 1000)).toEqual({ v: 1 });
    expect(await fetchJson(url, 0)).toEqual({ v: 2 }); // ttl 0 -> always stale
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("in-flight coalescing", () => {
  it("collapses concurrent calls for the same URL into one request", async () => {
    const url = uniqueUrl();
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    // Mirrors property_report: seven sections asking for the same URL at once.
    const all = Promise.all(Array.from({ length: 7 }, () => fetchJson(url)));
    release(jsonResponse({ shared: true }));
    const results = await all;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(7);
    for (const r of results) expect(r).toEqual({ shared: true });
  });

  it("does not cache a failure, and lets the next call retry cleanly", async () => {
    const url = uniqueUrl();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson(url)).rejects.toThrow("boom");
    expect(await fetchJson(url)).toEqual({ recovered: true });
  });
});

describe("retry policy", () => {
  it("retries a 503 and succeeds", async () => {
    const url = uniqueUrl();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchJson(url)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 (rate limit)", async () => {
    const url = uniqueUrl();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchJson(url)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 404 — it is a meaningful answer for DVF lookups", async () => {
    const url = uniqueUrl();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson(url)).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 attempts on persistent failure", async () => {
    const url = uniqueUrl();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson(url)).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
