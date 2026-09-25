import { fetchJson } from "../http.js";

/**
 * Local urbanism rules, via the Géoportail de l'urbanisme (GPU) exposed by the
 * IGN "API Carto" (public, no key).
 *
 * The GPU publishes the *opposable* documents — PLU, PLUi, POS, cartes
 * communales — that legally fix what may be built. For a point it answers three
 * questions a due-diligence file must answer:
 *
 *  - which zoning area applies (`zone-urba`: U / AU / A / N, plus the local
 *    label and the regulation file);
 *  - which surface prescriptions constrain the plot (`prescription-surf`:
 *    emplacements réservés, espaces boisés classés, périmètres…);
 *  - which linear and point prescriptions apply (`prescription-lin`,
 *    `prescription-pct`: alignements, arbres remarquables, monuments…).
 *
 * It returns the *rules*, never an answer to "can I build this?": that requires
 * reading the règlement and, usually, a certificat d'urbanisme.
 */
const GPU_API = "https://apicarto.ign.fr/api/gpu";
export const GPU_SOURCE = "Géoportail de l'urbanisme (GPU), DGALN / IGN — API Carto";
export const GPU_SOURCE_URL = "https://apicarto.ign.fr/api/doc/gpu";

export interface UrbanismZone {
  /** Local label, e.g. "UCe1b". */
  label: string | null;
  /** Full written description of the area. */
  description: string | null;
  /** "U" urban, "AU" to be urbanised, "A" agricultural, "N" natural. */
  type: string | null;
  /** Planning document partition, e.g. "DU_200046977". */
  partition: string | null;
  document_id: string | null;
  document_valid_from: string | null;
  regulation_file: string | null;
  document_url: string | null;
}

export interface UrbanismPrescription {
  label: string | null;
  /** ISOG prescription code (e.g. "17" mixité sociale, "23" taille des logements). */
  type_code: string | null;
  subtype_code: string | null;
  /** "surf" = surface, "lin" = linear, "pct" = point. */
  geometry_kind: "surf" | "lin" | "pct";
  /** Free-text value carried by the prescription, when published. */
  value: string | null;
  document_id: string | null;
  document_valid_from: string | null;
  regulation_file: string | null;
}

interface GpuFeature {
  properties?: Record<string, unknown>;
}

interface GpuResponse {
  features?: GpuFeature[];
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Pure mapper for a zone-urba feature. */
export function toZone(feature: GpuFeature): UrbanismZone {
  const p = feature.properties ?? {};
  return {
    label: text(p.libelle),
    description: text(p.libelong),
    type: text(p.typezone),
    partition: text(p.partition),
    document_id: text(p.idurba),
    document_valid_from: text(p.datvalid),
    regulation_file: text(p.nomfic),
    document_url: text(p.urlfic),
  };
}

/** Pure mapper for a prescription feature, whatever its geometry. */
export function toPrescription(
  feature: GpuFeature,
  geometryKind: UrbanismPrescription["geometry_kind"],
): UrbanismPrescription {
  const p = feature.properties ?? {};
  return {
    label: text(p.libelle),
    type_code: text(p.typepsc),
    subtype_code: text(p.stypepsc),
    geometry_kind: geometryKind,
    value: text(p.txt) ?? text(p.nature),
    document_id: text(p.idurba),
    document_valid_from: text(p.datvalid),
    regulation_file: text(p.nomfic),
  };
}

function pointGeometry(lat: number, lon: number): string {
  return encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
}

async function fetchGpu(endpoint: string, lat: number, lon: number): Promise<GpuFeature[]> {
  // Urbanism documents change rarely: a day-long cache is safe and keeps the
  // public GPU service out of the loop for repeated reports on one address.
  const data = await fetchJson<GpuResponse>(
    `${GPU_API}/${endpoint}?geom=${pointGeometry(lat, lon)}`,
    24 * 60 * 60_000,
  );
  return data.features ?? [];
}

export async function zonesAtPoint(lat: number, lon: number): Promise<UrbanismZone[]> {
  return (await fetchGpu("zone-urba", lat, lon)).map(toZone);
}

const PRESCRIPTION_ENDPOINTS: [string, UrbanismPrescription["geometry_kind"]][] = [
  ["prescription-surf", "surf"],
  ["prescription-lin", "lin"],
  ["prescription-pct", "pct"],
];

/** All prescriptions at the point, de-duplicated on their published label. */
export async function prescriptionsAtPoint(
  lat: number,
  lon: number,
): Promise<UrbanismPrescription[]> {
  const groups = await Promise.all(
    PRESCRIPTION_ENDPOINTS.map(async ([endpoint, kind]) =>
      (await fetchGpu(endpoint, lat, lon)).map((f) => toPrescription(f, kind)),
    ),
  );
  const seen = new Set<string>();
  const out: UrbanismPrescription[] = [];
  for (const prescription of groups.flat()) {
    const key = `${prescription.label}|${prescription.type_code}|${prescription.geometry_kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prescription);
  }
  return out;
}