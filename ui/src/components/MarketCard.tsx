import { eurM2, num } from "../format";
import type { MarketBlock, StatsBlock } from "../types";
import { Card, Empty, Stat } from "./ui";

function statsRow(stats: StatsBlock | null | undefined, label: string) {
  if (!stats || !stats.sales) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="stat" style={{ marginBottom: 8 }}>
        <div className="k">{label}</div>
      </div>
      <div className="stat-row">
        <Stat label="Médiane" value={eurM2(stats.median_eur_m2)} small />
        <Stat label="Moyenne" value={eurM2(stats.mean_eur_m2)} small />
        <Stat label="1er quartile" value={eurM2(stats.p25_eur_m2)} small />
        <Stat label="3e quartile" value={eurM2(stats.p75_eur_m2)} small />
        <Stat label="Ventes" value={num(stats.sales)} small />
      </div>
    </div>
  );
}

/** Per-year median €/m² as a small bar chart — the market trend at a glance. */
function YearBars({ byYear }: { byYear: Record<string, { sales: number; median_eur_m2: number }> }) {
  const entries = Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b));
  if (entries.length === 0) return null;

  const values = entries.map(([, v]) => v.median_eur_m2).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // Scale from a bit under the minimum so differences stay visible.
  const floor = min - (max - min) * 0.35 - 1;
  const height = (v: number) => Math.max(((v - floor) / (max - floor)) * 100, 3);

  return (
    <div>
      <div className="stat" style={{ marginBottom: 10 }}>
        <div className="k">Médiane €/m² par année de vente</div>
      </div>
      <div className="bars">
        {entries.map(([year, v]) => (
          <div className="bar-col" key={year} title={`${year} — ${num(v.sales)} ventes`}>
            <div className="bar-val">{num(v.median_eur_m2)}</div>
            <div className="bar" style={{ height: `${height(v.median_eur_m2)}%` }} />
            <div className="bar-lbl">{year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketCard({ block }: { block: MarketBlock }) {
  const hasAnything = block.all_period || block.last_12_months;
  const byYear = block.by_year ?? {};

  return (
    <Card
      title="Marché — prix au m²"
      note={block.query?.scope ? <span className="mono">{block.query.scope}</span> : undefined}
    >
      {!hasAnything ? (
        <Empty>Aucune vente exploitable dans ce périmètre.</Empty>
      ) : (
        <>
          {statsRow(
            block.last_12_months,
            `12 derniers mois${block.last_12_months?.window ? ` (${block.last_12_months.window})` : ""}`,
          )}
          {statsRow(block.all_period, "Toutes périodes confondues")}
          <YearBars byYear={byYear} />
          {block.note ? <div className="source-note">{block.note}</div> : null}
        </>
      )}
    </Card>
  );
}
