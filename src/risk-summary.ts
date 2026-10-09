/**
 * One sentence per risk, for a consumer-facing digest.
 *
 * Géorisques reports risks with free-text labels that drift over time, so the
 * summariser matches them by keyword rather than by exact string, and every
 * category it does not recognise is still surfaced by name — nothing present is
 * silently dropped. The one rule that matters: a source that could not be
 * reached is reported as **unknown**, never as absent. A blank "no risk" reads
 * as a clean bill of health, which is exactly what this must never fake.
 */
import type { SimplifiedRisks } from "./apis/georisques.js";
import type { RentalCompliance } from "./dpe-compliance.js";

export type RiskItemStatus = "present" | "absent" | "unknown";

export interface RiskItem {
  key: string;
  label: string;
  /** `unknown` = Géorisques unreachable, or no readable DPE — never "safe". */
  status: RiskItemStatus;
  at_address: string | null;
  in_commune: string | null;
  /** One plain-language line a client can render as-is. */
  sentence: string;
}

interface Category {
  key: string;
  label: string;
  /**
   * How the category is named mid-sentence in the headline. Written out rather
   * than derived from `label`, so an acronym survives the lowercase ("ICPE",
   * never "icpe").
   */
  headline_label: string;
  /** Matches the Géorisques libellé, across both risk families. */
  match: RegExp;
}

/** The categories the digest always answers, present or not. */
const CATEGORIES: Category[] = [
  { key: "inondation", label: "Inondation", headline_label: "inondation", match: /inondation/i },
  {
    key: "argile",
    label: "Retrait-gonflement des argiles",
    headline_label: "retrait-gonflement des argiles",
    match: /argile|retrait-gonflement|tassement|mouvement de terrain/i,
  },
  { key: "radon", label: "Radon", headline_label: "radon", match: /radon/i },
  {
    key: "icpe",
    label: "Sites industriels (ICPE)",
    headline_label: "sites industriels (ICPE)",
    match: /industriel|icpe|industrie/i,
  },
];

/** Name a category uses inside the headline (keeps acronym casing). */
const HEADLINE_LABEL = new Map(CATEGORIES.map((c) => [c.key, c.headline_label]));

/** How the DPE half of the digest was obtained. */
export type DpeState = "checked" | "not_checked" | "error";

export interface RiskSummaryInput {
  risks: SimplifiedRisks;
  dpe?: { state: DpeState; compliance?: RentalCompliance | null };
}

export interface RiskSummary {
  available: boolean;
  items: RiskItem[];
  /** Items reading `present` — a risk signalled, or a rental ban that applies. */
  signals_count: number;
  /** Present risks outside the summarised categories, named so nothing is hidden. */
  other_present_risks: string[];
  headline: string;
}

function dpeItem(state: DpeState, compliance: RentalCompliance | null | undefined): RiskItem {
  const base = { key: "dpe", label: "DPE / location", at_address: null, in_commune: null };

  if (state !== "checked") {
    const sentence =
      state === "not_checked"
        ? "DPE : non vérifié (aucune adresse fournie) — statut locatif inconnu."
        : "DPE : indisponible — statut locatif inconnu.";
    return { ...base, status: "unknown", sentence };
  }

  if (!compliance) {
    return { ...base, status: "unknown", sentence: "DPE : aucun diagnostic enregistré — statut locatif inconnu." };
  }

  const label = compliance.energy_label;
  const atAddress = label ? `étiquette ${label}` : null;

  switch (compliance.rental_status) {
    case "louable":
      return {
        ...base,
        at_address: atAddress,
        status: "absent",
        sentence: `DPE ${label} : louable, aucune interdiction programmée.`,
      };
    case "bientot_interdit":
      return {
        ...base,
        at_address: atAddress,
        status: "present",
        sentence: `DPE ${label} : location bientôt interdite à partir du ${compliance.ban_date}.`,
      };
    case "interdit":
      return {
        ...base,
        at_address: atAddress,
        status: "present",
        sentence: `DPE ${label} : location interdite depuis le ${compliance.ban_date}.`,
      };
    default:
      return { ...base, status: "unknown", sentence: "DPE : étiquette illisible — statut locatif inconnu." };
  }
}

/**
 * Turn a Géorisques report (plus an optional DPE compliance) into a flat list
 * of one-line items and a headline. Pure: no network, no clock, injectable.
 */
export function summarizeRisks(input: RiskSummaryInput): RiskSummary {
  const { risks } = input;
  const all = [...risks.naturalRisks, ...risks.technologicalRisks];
  const available = risks.available;

  const items: RiskItem[] = CATEGORIES.map((cat) => {
    if (!available) {
      return {
        key: cat.key,
        label: cat.label,
        status: "unknown",
        at_address: null,
        in_commune: null,
        sentence: `${cat.label} : statut INCONNU — Géorisques injoignable.`,
      };
    }

    const hits = all.filter((r) => cat.match.test(r.risk));
    if (hits.length === 0) {
      return {
        key: cat.key,
        label: cat.label,
        status: "absent",
        at_address: null,
        in_commune: null,
        sentence: `${cat.label} : non signalé par Géorisques à cette adresse.`,
      };
    }

    const at = hits.map((h) => h.statusAtAddress).find((s): s is string => Boolean(s)) ?? null;
    const inCommune = hits.map((h) => h.statusInCommune).find((s): s is string => Boolean(s)) ?? null;
    // Géorisques often reports the same status at the address and in the
    // commune; repeating it would read as two distinct findings.
    const where = [...new Set([at, inCommune].filter((s): s is string => Boolean(s)))];
    return {
      key: cat.key,
      label: cat.label,
      status: "present",
      at_address: at,
      in_commune: inCommune,
      sentence: `${cat.label} : signalé${where.length > 0 ? ` (${where.join(" ; ")})` : ""}.`,
    };
  });

  items.push(dpeItem(input.dpe?.state ?? "not_checked", input.dpe?.compliance));

  const matched = (risk: string) => CATEGORIES.some((c) => c.match.test(risk));
  const other = available ? [...new Set(all.filter((r) => !matched(r.risk)).map((r) => r.risk))] : [];

  const riskPresent = items.filter((i) => i.key !== "dpe" && i.status === "present");
  const dpe = items.find((i) => i.key === "dpe")!;

  const headline = !available
    ? "Statut de risque INCONNU : Géorisques est injoignable — ce n'est PAS une absence de risque."
    : `${riskPresent.length === 0
        ? "Aucun risque signalé par Géorisques aux catégories surveillées"
        : `Risque(s) signalé(s) : ${riskPresent.map((i) => HEADLINE_LABEL.get(i.key) ?? i.label).join(", ")}`}. ${dpe.sentence}`;

  return {
    available,
    items,
    signals_count: items.filter((i) => i.status === "present").length,
    other_present_risks: other,
    headline,
  };
}
