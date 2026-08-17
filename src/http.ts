const USER_AGENT = "mcp-immo-france/0.3 (+https://github.com/zedd75/mcp-imo)";
const TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 80;

/**
 * Requests currently in flight, keyed like the cache.
 *
 * property_report fans out to seven sections at once, and each one geocodes
 * the same address and pulls the same commune CSVs. Without coalescing, the
 * value cache never helps — none of the parallel calls has resolved yet — so
 * the same URL is fetched seven times simultaneously. That thundering herd
 * against the public open-data endpoints is what made the weekly smoke test
 * fail intermittently (a different section erroring each time).
 */
const inflight = new Map<string, Promise<unknown>>();

function cacheGet(key: string, ttlMs: number): unknown | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    // True LRU: re-insert on access so hot entries survive eviction.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  }
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    // Evict the least recently used entry to bound memory
    // (commune CSVs can be several MB each).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** 404/403 are meaningful answers here (no DVF file for that commune-year). */
function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status >= 500;
  return true; // network error, timeout, aborted socket
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      lastError = e;
      if (attempt === MAX_ATTEMPTS || !isRetryable(e)) throw e;
      // Exponential backoff with jitter: 400ms, 800ms (+ up to 250ms).
      await sleep(400 * 2 ** (attempt - 1) + Math.random() * 250);
    }
  }
  throw lastError;
}

/** Run `work` once per key even when called concurrently. */
async function coalesce<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
  const cached = cacheGet(key, ttlMs);
  if (cached !== undefined) return cached as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = work()
    .then((value) => {
      cacheSet(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function fetchJson<T>(url: string, ttlMs = 5 * 60_000): Promise<T> {
  return coalesce(url, ttlMs, async () => {
    const res = await request(url);
    return (await res.json()) as T;
  });
}

export async function fetchText(
  url: string,
  ttlMs = 6 * 60 * 60_000,
  encoding: "utf-8" | "latin1" = "utf-8",
): Promise<string> {
  return coalesce(`${encoding}:${url}`, ttlMs, async () => {
    const res = await request(url);
    return encoding === "latin1"
      ? new TextDecoder("latin1").decode(await res.arrayBuffer())
      : await res.text();
  });
}
