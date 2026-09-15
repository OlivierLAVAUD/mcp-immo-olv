import { dateFr, num } from "../format";
import type { DpeBlock } from "../types";
import { Card, Empty, LabelChip } from "./ui";

export default function DpeCard({ block }: { block: DpeBlock }) {
  const rows = block.diagnostics ?? [];

  return (
    <Card
      title="Diagnostics de performance énergétique"
      note={
        block.total_found !== undefined
          ? `${num(block.total_found)} trouvé${block.total_found > 1 ? "s" : ""} · ${block.query?.match ?? ""}`
          : undefined
      }
      tight
    >
      {rows.length === 0 ? (
        <Empty>Aucun DPE enregistré à cette adresse dans la base ADEME.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DPE</th>
                  <th>GES</th>
                  <th>Adresse</th>
                  <th>Bâtiment</th>
                  <th className="num">Surface</th>
                  <th className="num">Constr.</th>
                  <th className="num">Conso.</th>
                  <th>Établi le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => (
                  <tr key={`${d.identifiant_ban}-${d.date_etablissement_dpe}-${i}`}>
                    <td>
                      <LabelChip value={d.etiquette_dpe} />
                    </td>
                    <td>
                      <LabelChip value={d.etiquette_ges} />
                    </td>
                    <td className="address-cell">{d.adresse_ban || "—"}</td>
                    <td>{d.type_batiment || "—"}</td>
                    <td className="num">
                      {d.surface_habitable_logement ? `${num(d.surface_habitable_logement)} m²` : "—"}
                    </td>
                    <td className="num">{d.annee_construction ?? "—"}</td>
                    <td className="num">
                      {d.conso_5_usages_par_m2_ep !== undefined
                        ? `${num(d.conso_5_usages_par_m2_ep)} kWh/m²/an`
                        : "—"}
                    </td>
                    <td>{dateFr(d.date_etablissement_dpe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note ? <div className="source-note" style={{ padding: "12px 18px 16px" }}>{block.note}</div> : null}
        </>
      )}
    </Card>
  );
}
