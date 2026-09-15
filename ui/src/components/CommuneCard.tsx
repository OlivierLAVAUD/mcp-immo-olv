import { num } from "../format";
import type { Commune, CommuneBlock } from "../types";
import { Card, Empty } from "./ui";

/**
 * `departement` and `region` come back from geo.api.gouv.fr as {code, nom}
 * objects — rendering one directly throws "Objects are not valid as a React
 * child", so everything goes through this.
 */
function nameOf(value: Commune["departement"] | Commune["region"]): string {
  if (!value) return "—";
  if (typeof value === "string") return value;
  return value.nom ?? value.code ?? "—";
}

export default function CommuneCard({ block }: { block: CommuneBlock }) {
  const communes = block.communes ?? [];

  return (
    <Card title="Profil de la commune">
      {communes.length === 0 ? (
        <Empty>Aucune donnée de commune.</Empty>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {communes.map((c) => (
            <div key={c.insee_code ?? c.nom}>
              <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 10 }}>
                {c.nom ?? "—"}{" "}
                {c.insee_code ? <span className="badge">INSEE {c.insee_code}</span> : null}
              </div>
              <dl className="kv">
                <dt>Population</dt>
                <dd>{c.population ? num(c.population) : "—"}</dd>
                <dt>Codes postaux</dt>
                <dd>{(c.postcodes ?? []).join(", ") || "—"}</dd>
                <dt>Département</dt>
                <dd>{nameOf(c.departement)}</dd>
                <dt>Région</dt>
                <dd>{nameOf(c.region)}</dd>
                <dt>Surface</dt>
                <dd>{c.surface_km2 ? `${num(c.surface_km2, 1)} km²` : "—"}</dd>
                <dt>Centre</dt>
                <dd>
                  {c.center ? `${num(c.center.lat, 4)}, ${num(c.center.lon, 4)}` : "—"}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
