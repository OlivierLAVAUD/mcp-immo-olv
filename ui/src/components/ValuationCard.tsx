import { CONFIDENCE_LABEL, dateFr, eur, eurM2, eurM2Month, meters, num, pct } from "../format";
import type { ValuationBlock } from "../types";
import { Card, Empty, RangeBar, Stat } from "./ui";

/**
 * The valuation is the reason this MCP exists, so it gets the hero treatment:
 * a headline figure, the weighted 25–75 % range it came from, and the comps
 * table underneath so the number can actually be audited.
 */
export default function ValuationCard({ block }: { block: ValuationBlock }) {
  const est = block.estimate;
  if (!est?.value_eur || !est.per_m2) {
    return (
      <Card title="Estimation par comparables">
        <Empty>Aucune estimation renvoyée pour cette adresse.</Empty>
      </Card>
    );
  }

  const { value_eur: value, per_m2: perM2 } = est;
  const confidence = est.confidence ?? "low";
  const comps = est.top_comps ?? [];

  return (
    <section className="hero">
      <div className="hero-top">
        <div>
          <div className="hero-value">{eur(value.estimate)}</div>
          <div className="hero-range">
            Fourchette pondérée 25–75 % : {eur(value.low)} – {eur(value.high)}
          </div>
          <div className="hero-m2">
            {eurM2(perM2.estimate)} · {eurM2(perM2.low)} – {eurM2(perM2.high)}
          </div>
        </div>
        <div className="hero-side">
          <span className={`confidence ${confidence}`}>
            Confiance {CONFIDENCE_LABEL[confidence] ?? confidence}
          </span>
          <span className="badge">{num(est.comps_used)} comparables</span>
          <span className="badge accent" title="Kish : nombre de comparables également pondérés que vaut réellement l'échantillon">
            ESS {num(est.effective_sample_size, 1)}
          </span>
          <span className="badge">Marché {est.reference_year}</span>
        </div>
      </div>

      <RangeBar
        low={value.low ?? 0}
        estimate={value.estimate ?? 0}
        high={value.high ?? 0}
        format={(v) => eur(v)}
      />

      {block.rental ? (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
          <div className="stat-row">
            <Stat
              label="Loyer indicatif"
              value={eurM2Month(block.rental.rent_eur_m2_month)}
              small
            />
            <Stat
              label="Loyer mensuel estimé"
              value={eur(block.rental.estimated_monthly_rent_eur)}
              small
            />
            <Stat label="Rendement brut" value={pct(block.rental.gross_yield_pct, 2)} small />
            {block.rental.property_tax_average ? (
              <Stat
                label={`Taxe foncière moyenne ${block.rental.property_tax_average.year ?? ""}`}
                value={eur(block.rental.property_tax_average.typical_annual_charge_eur)}
                small
              />
            ) : null}
            {block.rental.net_yield_after_average_property_tax_pct !== undefined ? (
              <Stat
                label="Rendement après TF moyenne"
                value={pct(block.rental.net_yield_after_average_property_tax_pct, 2)}
                small
              />
            ) : null}
            <Stat
              label="Indicateur"
              value={<span className="mono" style={{ fontSize: 12.5 }}>{block.rental.indicator ?? "—"}</span>}
              small
            />
          </div>
        </div>
      ) : null}

      {block.rental?.property_tax_average ? (
        <div className="source-note">
          Taxe foncière : moyenne agrégée par article taxable REI ({block.rental.property_tax_average.coverage === "complete" ? "composantes publiées complètes" : "couverture partielle"}), pas l'avis de taxe foncière du bien. {block.rental.property_tax_average.caveats?.[1] ?? ""}
        </div>
      ) : null}

      {comps.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div className="stat" style={{ marginBottom: 8 }}>
            <div className="k">
              Ventes retenues comme comparables — poids normalisé, plus proche et plus récent = plus lourd
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Adresse</th>
                  <th className="num">Dist.</th>
                  <th className="num">Surface</th>
                  <th className="num">Pièces</th>
                  <th className="num">Prix</th>
                  <th className="num">€/m²</th>
                  <th className="num" title="€/m² ramené au niveau de marché de l'année de référence">
                    €/m² ajusté
                  </th>
                  <th className="num">Coef. année</th>
                  <th className="num">Poids</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={`${c.date}-${c.address}-${i}`}>
                    <td>{dateFr(c.date)}</td>
                    <td className="address-cell">{c.address || "—"}</td>
                    <td className="num">{meters(c.distance_m)}</td>
                    <td className="num">{c.surface_m2 ? `${num(c.surface_m2)} m²` : "—"}</td>
                    <td className="num">{c.rooms ?? "—"}</td>
                    <td className="num">{eur(c.price_eur)}</td>
                    <td className="num">{eurM2(c.price_m2)}</td>
                    <td className="num strong">{eurM2(c.price_m2_adjusted)}</td>
                    <td className="num">{num(c.year_adjustment, 3)}</td>
                    <td className="num">{num(c.weight, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {est.year_medians_eur_m2 && Object.keys(est.year_medians_eur_m2).length > 0 ? (
        <div className="source-note">
          Médianes communales €/m² servant à ramener les ventes anciennes au niveau actuel :{" "}
          {Object.entries(est.year_medians_eur_m2)
            .map(([y, v]) => `${y} : ${eurM2(v)}`)
            .join(" · ")}
        </div>
      ) : null}

      {block.caveats && block.caveats.length > 0 ? (
        <ul className="source-note" style={{ paddingLeft: 18, marginBottom: 0 }}>
          {block.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
