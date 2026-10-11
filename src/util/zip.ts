/**
 * A minimal ZIP reader for the two compressed files this project consumes:
 * INSEE's `populations légales` workbook (a .zip of CSVs) and Montpellier's
 * rent-control grid (an .xlsx, itself a .zip of XML). Node exposes no zip API
 * and this project takes no dependency, so the central directory is parsed
 * here and entries are inflated with the platform `DecompressionStream`.
 *
 * Scope is deliberately narrow: locate entries by name and read them back as
 * text. Encryption, zip64 and data descriptors are not handled — none of the
 * official open-data files this reads use them.
 */
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";

const inflateRawAsync = promisify(inflateRaw);

export interface ZipEntry {
  /** Byte offset of the entry's data within the archive. */
  dataOffset: number;
  /** Compressed size in bytes. */
  length: number;
  /** 0 = stored (raw), 8 = deflated. */
  method: number;
}

/**
 * The central directory: entry name -> where its bytes live. Scanned backwards
 * for the end-of-central-directory record (EOCD), so the scan cannot overshoot
 * the archive's end.
 */
export function zipCentralDirectory(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");

  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip (no end of central directory)");

  const entries = new Map<string, ZipEntry>();
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const headerOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(u8.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = view.getUint16(headerOffset + 26, true);
    const localExtraLen = view.getUint16(headerOffset + 28, true);
    entries.set(name, {
      dataOffset: headerOffset + 30 + localNameLen + localExtraLen,
      length: view.getUint32(offset + 24, true),
      method,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry (stored or deflated) to plain text. */
export async function inflateZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const slice = Buffer.from(buffer.slice(entry.dataOffset, entry.dataOffset + entry.length));
  if (entry.method === 0) return slice.toString("utf-8");
  return (await inflateRawAsync(slice)).toString("utf-8");
}
