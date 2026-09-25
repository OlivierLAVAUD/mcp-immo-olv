import { eur, num } from "../format";
import type { PropertyTaxBlock } from "../types";
import { Card, Empty } from "./ui";

/**
 * The REI value is a commune-wide average by taxable article, never an
 * individual tax notice. This card intentionally puts that caveat beside the
 * number instead of hiding it in a tooltip.
 */
export default function PropertyTaxCard({ block }: { block: PropertyTaxBlock }) {
  const components = (block.components ?? []).filter((c) => c.average_charge_eur !== null);

  return (
    <Card
      title="Taxe foncière — repère communal"
      note={block.year ? `REI ${block.year} · ${block.coverage === "complete" ? "complet" : "partiel"}` : undefined}
      tight
    >
      {block.typical_annual_charge_eur === undefined ? (
        <Empty>Aucune donnée fiscale exploitable pour cette commune.</Empty>
      ) : (
        <>
          <div className="card-body">
            <div className="stat-row">
              <div className="stat">
                <div className="k">Charge moyenne annuelle</div>
                <div className="v">{eur(block.typical_annual_charge_eur)}</div>
                <div className="u">par article taxable REI</div>
              </div>
              <div className="stat">
                <div className="k">Commune</div>
                <div className="v sm mono">{block.insee_code ?? "—"}</div>
                <div className="u">code INSEE fiscal</div>
              </div>
            </div>
          </div>
          {components.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Composante</th>
                    <th className="num">Produit agrégé</th>
                    <th className="num">Articles</th>
                    <th className="num">Moyenne / article</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((component) => (
                    <tr key={component.code ?? component.label}>
                      <td>{component.label ?? component.code ?? "—"}</td>
                      <td className="num">{eur(component.amount_eur)}</td>
                      <td className="num">{num(component.taxable_articles)}</td>
                      <td className="num strong">{eur(component.average_charge_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="source-note" style={{ padding: "12px 18px 16px" }}>
            {block.caveats?.[0] ?? "Montant agrégé, pas un avis de taxe foncière individuel."}{" "}
            {block.caveats?.[1] ?? ""}
          </div>
        </>
      )}
    </Card>
  );
}
