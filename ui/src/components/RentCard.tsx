import { eurM2Month, num, RENT_KIND_LABEL } from "../format";
import type { RentBlock } from "../types";
import { Card, Empty } from "./ui";

export default function RentCard({ block }: { block: RentBlock }) {
  const entries = Object.entries(block.indicators ?? {}).filter(([, v]) => v !== null && v !== undefined);

  return (
    <Card
      title="Loyers d'annonce officiels"
      note={block.year ? `Carte des loyers ${block.year}` : undefined}
      tight
    >
      {entries.length === 0 ? (
        <Empty>Aucun indicateur de loyer pour cette commune.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Segment</th>
                  <th className="num">Loyer</th>
                  <th className="num">Fourchette</th>
                  <th className="num">Annonces</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([kind, value]) => (
                  <tr key={kind}>
                    <td>{RENT_KIND_LABEL[kind] ?? kind}</td>
                    <td className="num strong">{eurM2Month(value!.rent_eur_m2_month)}</td>
                    <td className="num">
                      {value!.range_eur_m2_month
                        ? `${num(value!.range_eur_m2_month[0], 1)} – ${num(value!.range_eur_m2_month[1], 1)}`
                        : "—"}
                    </td>
                    <td className="num">{value!.listings_observed ? num(value!.listings_observed) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="source-note" style={{ padding: "12px 18px 16px" }}>
            {block.note ?? ""}
            {block.location ? ` Commune : ${block.location}${block.insee_code ? ` (INSEE ${block.insee_code})` : ""}.` : ""}
          </div>
        </>
      )}
    </Card>
  );
}
