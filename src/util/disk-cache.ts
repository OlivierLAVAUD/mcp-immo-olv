/**
 * Optional second-level file cache for expensive open-data payloads.
 *
 * The in-memory caches in `http.ts` and `apis/dvf.ts` die with the process:
 * every restart re-downloads the same multi-MB DVF commune files and re-parses
 * them. Pointing IMMO_CACHE_DIR at a writable directory keeps those parsed
 * payloads on disk (write-time-stamped, TTL-checked), so a fresh process —
 * the same server after a restart, a sibling worker, a test — hydrates its
 * memory cache from the filesystem instead of the network.
 *
 * A cache is an optimization, never a source of truth: every disk failure
 * (missing directory, corrupt file, read-only mount, full disk) degrades
 * silently to memory-only behavior. The tools must never learn the directory
 * existed.
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The directory this process may spill parsed payloads into, if any. Read
 *  lazily (not once at import) so tests can point each case at its own
 *  temporary directory. */
export function diskCacheDir(): string | null {
  const dir = process.env.IMMO_CACHE_DIR;
  if (!dir || dir.trim() === "") return null;
  return dir;
}

/** What sits inside every cache file: a write timestamp, the TTL it was
 *  written under, and the payload. The timestamps travel with the data rather
 *  than living in the file mtime, so a copied or restored directory keeps
 *  honest TTLs — and a stale-file sweep can judge an entry without knowing the
 *  caller's read-time TTL. */
interface DiskEnvelope<T> {
  at: number;
  ttlMs: number;
  value: T;
}

/** Cap on files per cache folder: the commune/year space is effectively
 *  unbounded, but one host only ever asks for what its users query. Past the
 *  cap, expired files are swept; if the folder is still full, the write is
 *  skipped rather than evicting live entries another process may be reading. */
const MAX_FILES_PER_FOLDER = 512;

/**
 * A filename-safe path component. DVF keys are INSEE codes and years, but this
 * makes no such assumption: no caller input can ever escape the cache folder.
 */
function safeComponent(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** Read a payload back, or null on any miss: unset directory, missing or
 *  corrupt file, or an entry older than `ttlMs`. The read-time TTL wins over
 *  the stored one, so a caller tightening its freshness still gets it. */
export async function readDiskCache<T>(subdir: string, name: string, ttlMs: number): Promise<T | null> {
  const dir = diskCacheDir();
  if (!dir) return null;
  try {
    const raw = await readFile(join(dir, safeComponent(subdir), `${safeComponent(name)}.json`), "utf-8");
    const envelope = JSON.parse(raw) as Partial<DiskEnvelope<T>>;
    if (typeof envelope.at !== "number" || Date.now() - envelope.at > ttlMs) return null;
    if (envelope.value === undefined) return null;
    return envelope.value;
  } catch {
    return null;
  }
}

/** Persist a payload together with the TTL it is valid under. Never throws:
 *  on any failure the caller simply behaves as if the directory were unset. */
export async function writeDiskCache<T>(subdir: string, name: string, value: T, ttlMs: number): Promise<void> {
  const dir = diskCacheDir();
  if (!dir) return;
  const folder = join(dir, safeComponent(subdir));
  const target = join(folder, `${safeComponent(name)}.json`);
  try {
    await mkdir(folder, { recursive: true });
    // Atomic write: a concurrent reader (another worker, another restart)
    // never observes a half-written file — it sees the old one or the new one.
    const tmp = join(folder, `.${safeComponent(name)}.${process.pid}-${Math.floor(Math.random() * 1e9)}.tmp`);
    await writeFile(tmp, JSON.stringify({ at: Date.now(), ttlMs, value } satisfies DiskEnvelope<T>));
    await rename(tmp, target);
    await pruneExpired(folder);
  } catch {
    // Full disk, read-only mount, hostile permissions: not our problem.
  }
}

/** Keep the folder bounded: sweep files whose own stored TTL has expired, but
 *  only when the cap is exceeded — a readdir per write is cheap next to a
 *  multi-MB download, and below the cap there is nothing worth sweeping. */
async function pruneExpired(folder: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return;
  }
  const candidates = names.filter((n) => n.endsWith(".json") && !n.startsWith("."));
  if (candidates.length <= MAX_FILES_PER_FOLDER) return;
  const now = Date.now();
  await Promise.all(
    candidates.map(async (n) => {
      const path = join(folder, n);
      try {
        const raw = await readFile(path, "utf-8");
        const envelope = JSON.parse(raw) as Partial<DiskEnvelope<unknown>>;
        if (typeof envelope.at !== "number" || typeof envelope.ttlMs !== "number") {
          await unlink(path); // unreadable envelope: not a cache entry, sweep it
          return;
        }
        if (now - envelope.at <= envelope.ttlMs) return; // still live
        await unlink(path);
      } catch {
        // A file that cannot be read cannot be judged; leave it.
      }
    }),
  );
}
