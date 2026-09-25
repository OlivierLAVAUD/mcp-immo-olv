import type { RiskEntry, RisksBlock } from "../types";
import { Alert, Card, Empty } from "./ui";

/**
 * Géorisques phrases the status per risk: "Risque Existant" (you are exposed),
 * "Risque Existant - faible", "Risque non Concerne" (present in the commune but
 * not at this address). Only the first two deserve a warning tone.
 */
function statusBadge(status?: string | null) {
  const value = (status ?? "").trim();
  if (!value) return <span className="badge">—</span>;
  const lower = value.toLowerCase();
  const tone = /non\s*concern/.test(lower) ? "" : /existant|concerne/.test(lower) ? "warn" : "";
  return <span className={tone ? `badge ${tone}` : "badge"}>{value}</span>;
}

function RiskList({ title, entries }: { title: string; entries: RiskEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="stat" style={{ margin: "0 0 4px" }}>
        <div className="k">{title}</div>
      </div>
      <ul className="list-clean">
        {entries.map((r, i) => (
          <li key={`${r.risk}-${i}`}>
            <span className="grow">{r.risk ?? "Risque"}</span>
            <span title="Statut à l'adresse">{statusBadge(r.statusAtAddress)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RisksCard({ block }: { block: RisksBlock }) {
  const natural = block.naturalRisks ?? [];
  const techno = block.technologicalRisks ?? [];

  // Géorisques did not answer. Falling through would print "no risk reported at
  // this address", which reads as a clean bill of health — the exact opposite
  // of what an unanswered source tells us.
  if (block.available === false) {
    return (
      <Card title="Risques naturels et technologiques">
        <Alert kind="warn" title="Source indisponible — statut des risques inconnu">
          Géorisques n'a pas répondu
          {block.unavailable?.reason ? ` (${block.unavailable.reason})` : ""}. À cette adresse, le
          statut des risques est <strong>inconnu</strong> — ce qui n'est pas la même chose
          qu'« aucun risque ».
          {block.unavailable?.portal_url ? (
            <>
              {" "}
              <a href={block.unavailable.portal_url} target="_blank" rel="noreferrer">
                Vérifier sur georisques.gouv.fr
              </a>
            </>
          ) : null}
        </Alert>
      </Card>
    );
  }

  return (
    <Card
      title="Risques naturels et technologiques"
      note={block.commune ? block.commune : undefined}
    >
      {natural.length === 0 && techno.length === 0 ? (
        <Empty>Aucun risque signalé par Géorisques à cette adresse.</Empty>
      ) : (
        <>
          <RiskList title="Risques naturels présents" entries={natural} />
          <RiskList title="Risques technologiques présents" entries={techno} />
          {block.officialReportUrl ? (
            <div className="source-note">
              Rapport officiel complet :{" "}
              <a href={block.officialReportUrl} target="_blank" rel="noreferrer">
                georisques.gouv.fr
              </a>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
