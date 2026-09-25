import { dateFr, eur, eurM2, num } from "../format";
import type { Sale, SalesBlock } from "../types";
import { Card, Empty } from "./ui";

function dwellingsLabel(sale: Sale) {
  const parts = (sale.dwellings ?? []).map((d) => {
    const bits = [d.type ?? "local"];
    if (d.rooms) bits.push(`${d.rooms}p`);
    if (d.surface) bits.push(`${num(d.surface)} m²`);
    return bits.join(" · ");
  });
  return parts.length > 0 ? parts.join(" + ") : "—";
}

export default function SalesTable({ block }: { block: SalesBlock }) {
  const sales = block.sales ?? [];
  const total = block.total_matching_sales ?? sales.length;

  return (
    <Card
      title="Ventes notariées récentes"
      note={
        <>
          {num(total)} vente{total > 1 ? "s" : ""} correspondante{total > 1 ? "s" : ""}
          {sales.length < total ? ` · ${num(sales.length)} affichée${sales.length > 1 ? "s" : ""}` : ""}
        </>
      }
      tight
    >
      {sales.length === 0 ? (
        <Empty>Aucune vente notariée trouvée dans ce périmètre.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Adresse</th>
                  <th>Biens</th>
                  <th className="num">Prix</th>
                  <th className="num">€/m²</th>
                  <th className="num">Terrain</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={`${s.date}-${s.price_eur}-${i}`}>
                    <td>{dateFr(s.date)}</td>
                    <td className="address-cell">{(s.addresses ?? []).join(" / ") || "—"}</td>
                    <td>
                      {dwellingsLabel(s)}
                      {s.other_locals && s.other_locals.length > 0 ? (
                        <>
                          {" "}
                          <span className="badge">+ {s.other_locals.length} local(aux)</span>
                        </>
                      ) : null}
                    </td>
                    <td className="num strong">{eur(s.price_eur)}</td>
                    <td className="num">{s.price_per_m2 ? eurM2(s.price_per_m2) : "—"}</td>
                    <td className="num">{s.land_surface_m2 ? `${num(s.land_surface_m2)} m²` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note ? <div className="source-note" style={{ padding: "0 18px 16px" }}>{block.note}</div> : null}
        </>
      )}
    </Card>
  );
}
