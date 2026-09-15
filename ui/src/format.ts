/** French formatting helpers. Numbers are only ever shown to a human here. */

const nf = (digits: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const n0 = nf(0);
const n1 = nf(1);
const n2 = nf(2);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "1 234" */
export function num(value: unknown, digits = 0): string {
  if (!isNum(value)) return "—";
  return digits === 0 ? n0.format(value) : digits === 1 ? n1.format(value) : n2.format(value);
}

/** "1 234 €" */
export function eur(value: unknown, digits = 0): string {
  if (!isNum(value)) return "—";
  return `${num(value, digits)} €`;
}

/** "4 850 €/m²" */
export function eurM2(value: unknown, digits = 0): string {
  if (!isNum(value)) return "—";
  return `${num(value, digits)} €/m²`;
}

/** "3,9 %" */
export function pct(value: unknown, digits = 1): string {
  if (!isNum(value)) return "—";
  return `${num(value, digits)} %`;
}

/** "16,60 €/m²/mois" */
export function eurM2Month(value: unknown, digits = 2): string {
  if (!isNum(value)) return "—";
  return `${num(value, digits)} €/m²/mois`;
}

/** "12/03/2025" */
export function dateFr(iso: unknown): string {
  if (typeof iso !== "string" || iso.length < 10) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "1,2 km" / "340 m" */
export function meters(value: unknown): string {
  if (!isNum(value)) return "—";
  return value >= 1000 ? `${num(value / 1000, 1)} km` : `${num(value, 0)} m`;
}

/** Compact euro for chart axes: "4 850" or "1,2 M". */
export function compactEur(value: unknown): string {
  if (!isNum(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 1)} M€`;
  if (Math.abs(value) >= 10_000) return `${num(value / 1000, 0)} k€`;
  return num(value, 0);
}

/** Human label for the confidence level returned by the estimator. */
export const CONFIDENCE_LABEL: Record<string, string> = {
  high: "élevée",
  medium: "moyenne",
  low: "faible",
};

/** Human label for the rent indicator kinds. */
export const RENT_KIND_LABEL: Record<string, string> = {
  apartment: "Appartements (tous)",
  apartment_1_2_rooms: "Appartements 1–2 pièces",
  apartment_3plus_rooms: "Appartements 3 pièces et +",
  house: "Maisons",
};

export const DWELLING_LABEL: Record<string, string> = {
  Appartement: "Appartement",
  Maison: "Maison",
};
