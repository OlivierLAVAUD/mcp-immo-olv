/**
 * Markdown rendering of a `property_report` dossier.
 *
 * Pure function: it takes the structured dossier the handler already built and
 * renders shareable Markdown — a memo, an email, a note — without touching
 * the network. Every figure keeps the meaning it has in the JSON payload;
 * a section that failed is reported as unavailable with its reason, never
 * silently dropped, and the footer carries the sources and the standing
 * disclaimer that this is public-data analysis, not a professional appraisal.
 */

type Rec = Record<string, unknown>;

function asRecord(v: unknown): Rec | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isError(section: unknown): section is { error: string } {
  const r = asRecord(section);
  return r !== null && typeof r.error === "string";
}

function eur(n: number | null, decimals = 0): string {
  if (n === null) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}

function m2eur(n: number | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString("fr-FR")} €/m²`;
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function mdEscape(s: string | null): string {
  if (s === null) return "—";
  return s.replace(/\|/g, "\\|");
}

function sectionUnavailable(title: string, reason: string): string {
  return `## ${title}\n\n> ⚠️ **Section indisponible** — ${reason}\n`;
}

/* ------------------------------------------------------------- sections */

function renderMarket(m: unknown): string {
  if (isError(m)) return sectionUnavailable("Marché (DVF)", m.error);
  const r = asRecord(m);
  const last12 = asRecord(r?.last_12_months);
  const all = asRecord(r?.all_period);
  const query = asRecord(r?.query);
  const lines = [
    "## Marché (DVF)",
    "",
    `- **Médiane 12 derniers mois** : ${m2eur(num(last12?.median_eur_m2))}${last12 ? ` (${last12.sales} ventes)` : ""}`,
    `- Médiane toute période : ${m2eur(num(all?.median_eur_m2))} (${all?.sales ?? 0} ventes)`,
    `- Périmètre : ${str(query?.scope) ?? "—"}`,
  ];
  if (str(last12?.window)) lines.push(`- Fenêtre 12 mois : ${last12!.window}`);
  return lines.join("\n") + "\n";
}

function renderSales(s: unknown): string {
  if (isError(s)) return sectionUnavailable("Ventes notariées récentes", s.error);
  const r = asRecord(s);
  const sales = Array.isArray(r?.sales) ? (r!.sales as unknown[]) : [];
  const lines = [
    "## Ventes notariées récentes",
    "",
    `**${r?.total_matching_sales ?? sales.length} ventes** correspondent au périmètre. Les plus récentes :`,
    "",
    "| Date | Prix | Surface | €/m² |",
    "|---|---|---|---|",
  ];
  for (const sale of sales.slice(0, 8)) {
    const s0 = asRecord(sale);
    const price = num(s0?.price_eur);
    const surface = (s0?.dwellings as unknown[] | undefined)?.reduce(
      (acc: number, d) => acc + (num(asRecord(d)?.surface) ?? 0),
      0,
    );
    lines.push(
      `| ${str(s0?.date) ?? "—"} | ${eur(price)} | ${surface ? `${surface} m²` : "—"} | ${m2eur(num(s0?.price_per_m2))} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function renderValuation(v: unknown): string {
  if (isError(v)) return sectionUnavailable("Estimation par comparables", v.error);
  if (v === null || v === undefined) return "";
  const r = asRecord(v);
  const est = asRecord(r?.estimate);
  const val = asRecord(est?.value_eur);
  const rental = asRecord(r?.rental);
  const lines = [
    "## Estimation par comparables",
    "",
    `- **Valeur estimée** : ${eur(num(val?.estimate))} (fourchette ${eur(num(val?.low))} – ${eur(num(val?.high))})`,
    `- Confiance : **${str(est?.confidence) ?? "—"}** · ${est?.comps_used ?? 0} comparables (échantillon effectif ${est?.effective_sample_size ?? "—"})`,
  ];
  if (rental) {
    lines.push(
      `- Loyer d'annonce : ${m2eur(num(rental.rent_eur_m2_month))}/mois → ${eur(num(rental.estimated_monthly_rent_eur))}/mois`,
      `- Rendement locatif brut : **${pct(num(rental.gross_yield_pct))}**${num(rental.net_yield_after_average_property_tax_pct) !== null ? ` (net après taxe foncière moyenne : ${pct(num(rental.net_yield_after_average_property_tax_pct))})` : ""}`,
    );
  }
  return lines.join("\n") + "\n";
}

function renderRent(r0: unknown): string {
  if (isError(r0)) return sectionUnavailable("Loyers (Carte des loyers)", r0.error);
  const r = asRecord(r0);
  const lines = ["## Loyers (Carte des loyers)", ""];
  const kinds: Array<[string, string]> = [
    ["apartment", "Appartements"],
    ["apartment_1_2_rooms", "Appartements 1–2 pièces"],
    ["apartment_3plus_rooms", "Appartements 3+ pièces"],
    ["house", "Maisons"],
  ];
  for (const [key, label] of kinds) {
    const hit = asRecord(asRecord(r?.indicators)?.[key]);
    if (hit) {
      lines.push(
        `- ${label} : ${m2eur(num(hit.rent_eur_m2_month))}/mois (${hit.listings_observed ?? 0} annonces)${num(hit.estimated_monthly_rent_eur) !== null ? ` → ${eur(num(hit.estimated_monthly_rent_eur))}/mois` : ""}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function renderRentControl(c: unknown): string {
  if (isError(c)) return sectionUnavailable("Encadrement des loyers", c.error);
  const r = asRecord(c);
  const covered = r?.covered === true;
  if (!covered) {
    return `## Encadrement des loyers\n\nNon couvert : aucune grille de référence publiée pour cette zone (Paris et Métropole de Lyon uniquement). Voir le fichier de la commune pour les règles applicables.\n`;
  }
  const v = asRecord(r?.values);
  const lines = [
    "## Encadrement des loyers",
    "",
    `${str(r?.city) ?? ""}${str(r?.area_label) ? ` — ${r!.area_label}` : ""}${r?.rooms != null ? ` · ${r!.rooms} pièces` : ""}${r?.period != null ? ` · ${r!.period}` : ""}`,
    "",
    `- Loyer de référence : ${m2eur(num(v?.reference_eur_m2_month))}/mois`,
    `- **Plafond légal (majoré)** : ${m2eur(num(v?.ceiling_eur_m2_month))}/mois`,
    `- Plancher (minoré) : ${m2eur(num(v?.floor_eur_m2_month))}/mois`,
  ];
  return lines.join("\n") + "\n";
}

function renderTax(t: unknown): string {
  if (isError(t)) return sectionUnavailable("Fiscalité (REI)", t.error);
  const r = asRecord(t);
  const lines = [
    "## Fiscalité (REI)",
    "",
    `- **Taxe foncière moyenne communale** : ${eur(num(r?.typical_annual_charge_eur))}/an (millésime ${r?.year ?? "—"})`,
  ];
  const components = Array.isArray(r?.components) ? (r!.components as unknown[]) : [];
  for (const c of components) {
    const c0 = asRecord(c);
    if (num(c0?.average_charge_eur) !== null) {
      lines.push(`  - ${str(c0?.label) ?? str(c0?.code)} : ${eur(num(c0?.average_charge_eur))}`);
    }
  }
  lines.push("", "> Moyenne par article taxable du registre REI — **pas** l'avis de taxe foncière du bien.");
  return lines.join("\n") + "\n";
}

function renderEnergy(e: unknown): string {
  if (isError(e)) return sectionUnavailable("DPE & conformité locative", e.error);
  const r = asRecord(e);
  const diagnostics = Array.isArray(r?.diagnostics) ? (r!.diagnostics as unknown[]) : [];
  if (diagnostics.length === 0) {
    return "## DPE & conformité locative\n\nAucun diagnostic DPE enregistré pour cette adresse.\n";
  }
  const lines = [
    "## DPE & conformité locative",
    "",
    "| Adresse | DPE | Statut locatif | Interdiction | Coût énergétique |",
    "|---|---|---|---|---|",
  ];
  for (const d of diagnostics.slice(0, 5)) {
    const d0 = asRecord(d);
    const comp = asRecord(d0?.rental_compliance);
    const cost = asRecord(d0?.annual_energy_cost);
    const status = str(comp?.rental_status) ?? "inconnu";
    const ban = str(comp?.ban_date);
    const label = str(comp?.energy_label) ?? str(d0?.etiquette_dpe) ?? "—";
    lines.push(
      `| ${mdEscape(str(d0?.adresse_ban))} | **${label}** | ${status} | ${ban ?? "—"} | ${eur(num(cost?.annual_cost_eur))}/an |`,
    );
  }
  lines.push(
    "",
    "> Statut de location en résidence principale selon le décret n° 2024-501 (G/H interdits depuis 2025, F depuis 2028, E depuis 2034). « inconnu » = étiquette absente, jamais « louable ».",
  );
  return lines.join("\n") + "\n";
}

function renderRisks(rk: unknown): string {
  if (isError(rk)) return sectionUnavailable("Risques (Géorisques)", rk.error);
  const r = asRecord(rk);
  if (r?.available !== true) {
    const un = asRecord(r?.unavailable);
    return `## Risques (Géorisques)\n\n> ⚠️ **Statut INCONNU** — ${str(un?.reason) ?? "Géorisques injoignable"}. Ce n'est pas l'absence de risque : vérifier sur ${str(un?.portal_url) ?? "georisques.gouv.fr"}.\n`;
  }
  const lines = ["## Risques (Géorisques)", ""];
  const groups: Array<[string, unknown]> = [
    ["Risques naturels", r?.naturalRisks],
    ["Risques technologiques", r?.technologicalRisks],
  ];
  for (const [label, list] of groups) {
    const arr = Array.isArray(list) ? (list as unknown[]) : [];
    const present = arr.filter((x) => {
      const x0 = asRecord(x);
      return str(x0?.statusAtAddress) !== null || str(x0?.statusInCommune) !== null;
    });
    lines.push(`### ${label}`);
    if (present.length === 0) {
      lines.push("Aucun risque listé à cette adresse.");
    } else {
      for (const x of present.slice(0, 10)) {
        const x0 = asRecord(x);
        lines.push(
          `- **${str(x0?.risk) ?? "—"}** : à l'adresse — ${str(x0?.statusAtAddress) ?? "non renseigné"} ; dans la commune — ${str(x0?.statusInCommune) ?? "non renseigné"}`,
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function renderCommune(c: unknown): string {
  if (isError(c)) return sectionUnavailable("Commune (INSEE)", c.error);
  const r = asRecord(c);
  const communes = Array.isArray(r?.communes) ? (r!.communes as unknown[]) : [];
  if (communes.length === 0) return "";
  const c0 = asRecord(communes[0]);
  const pop = num(c0?.population);
  const surface = num(c0?.surface_km2);
  return (
    "## Commune (INSEE)\n\n" +
    `- ${str(c0?.nom) ?? "—"} (INSEE ${str(c0?.insee_code) ?? "—"})` +
    (pop !== null ? ` — population ${pop.toLocaleString("fr-FR")}` : "") +
    (surface !== null ? ` — ${surface.toLocaleString("fr-FR")} km²` : "") +
    "\n"
  );
}

function renderCadastre(c: unknown): string {
  if (isError(c)) return sectionUnavailable("Cadastre", c.error);
  const r = asRecord(c);
  const parcels = Array.isArray(r?.parcels) ? (r!.parcels as unknown[]) : [];
  if (parcels.length === 0) return "## Cadastre\n\nAucune parcelle cadastrale trouvée à ce point.\n";
  const lines = ["## Cadastre", "", "| idu | Section | Numéro | Contenance |", "|---|---|---|---|"];
  for (const p of parcels.slice(0, 5)) {
    const p0 = asRecord(p);
    lines.push(
      `| ${str(p0?.idu) ?? "—"} | ${str(p0?.section) ?? "—"} | ${str(p0?.numero) ?? "—"} | ${m2eur(num(p0?.contenance_m2))} |`,
    );
  }
  lines.push("", "> La contenance est la surface fiscale de la parcelle, terrain inclus — pas la surface habitable.");
  return lines.join("\n") + "\n";
}

function renderUrbanism(u: unknown): string {
  if (isError(u)) return sectionUnavailable("Urbanisme (PLU)", u.error);
  const r = asRecord(u);
  const zones = Array.isArray(r?.zoning_areas) ? (r!.zoning_areas as unknown[]) : [];
  if (zones.length === 0) {
    return `## Urbanisme (PLU)\n\n${str(r?.coverage_note) ?? "Aucun document d'urbanisme publié pour ce point."}\n`;
  }
  const lines = ["## Urbanisme (PLU)", ""];
  for (const z of zones.slice(0, 5)) {
    const z0 = asRecord(z);
    lines.push(
      `- **${str(z0?.type) ?? "?"}** — ${str(z0?.label) ?? str(z0?.description) ?? "—"}${str(z0?.regulation_file) ? ` (règlement : ${z0!.regulation_file})` : ""}`,
    );
  }
  lines.push("", "> Indique les règles applicables, jamais si un projet est permis.");
  return lines.join("\n") + "\n";
}

function renderIris(i: unknown): string {
  if (isError(i)) return sectionUnavailable("IRIS", i.error);
  const iris = asRecord(asRecord(i)?.iris);
  if (iris === null) return "";
  return (
    "## IRIS\n\n" +
    `- ${str(iris.name) ?? "—"} (code ${str(iris.code_iris) ?? "—"}, type ${str(iris.type) ?? "—"})\n\n` +
    "> Couche d'identité INSEE : ni population, ni revenu publiés ici.\n"
  );
}

/* ------------------------------------------------------------- main */

/**
 * Render a `property_report` dossier as shareable Markdown.
 * `today` is injectable for tests; the generated date uses the ISO day.
 */
export function renderReportMarkdown(dossier: unknown, today = new Date()): string {
  const r = asRecord(dossier) ?? {};
  const day = today.toISOString().slice(0, 10);

  const parts = [
    `# Dossier immobilier — ${str(r.resolved_address) ?? "adresse non résolue"}`,
    "",
    `*Généré le ${day} à partir de données publiques françaises — analyse open data, **pas un avis de valeur professionnel ni un conseil financier**.*`,
    "",
    renderMarket(r.market),
    renderSales(r.recent_sales_nearby),
    renderValuation(r.valuation),
    renderRent(r.rent),
    renderRentControl(r.rent_control),
    renderTax(r.property_tax),
    renderEnergy(r.energy_diagnostics),
    renderRisks(r.risks),
    renderCommune(r.commune),
    renderCadastre(r.cadastre),
    renderUrbanism(r.urbanism),
    renderIris(r.iris),
  ].filter((s) => s !== "");

  const footer = [
    "---",
    "",
    "## Sources",
    "",
    str(r.generated_from) ?? "Sources non renseignées",
    "",
    "*Les jeux publics sont interrogés en direct, sans clé API. Chaque chiffre est une analyse d'open data à confirmer avant toute décision.*",
  ];

  return parts.join("\n") + footer.join("\n") + "\n";
}



