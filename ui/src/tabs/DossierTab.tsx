import { useState } from "react";
import { callTool } from "../api";
import CommuneCard from "../components/CommuneCard";
import DpeCard from "../components/DpeCard";
import MarketCard from "../components/MarketCard";
import PropertyTaxCard from "../components/PropertyTaxCard";
import RentCard from "../components/RentCard";
import RisksCard from "../components/RisksCard";
import SalesTable from "../components/SalesTable";
import ValuationCard from "../components/ValuationCard";
import { Alert, Card, SectionError, Spinner } from "../components/ui";
import { num } from "../format";
import type {
  CommuneBlock,
  DpeBlock,
  MarketBlock,
  PropertyReport,
  PropertyTaxBlock,
  RentBlock,
  RisksBlock,
  SalesBlock,
  ValuationBlock,
} from "../types";
import { isErrorBlock } from "../types";

const EXAMPLES = [
  "12 rue de la République, Lyon",
  "8 rue Oberkampf, Paris",
  "25 cours Gambetta, Lyon",
  "Arcachon",
  "5 avenue Anatole France, Paris",
];

export default function DossierTab() {
  const [address, setAddress] = useState("12 rue de la République, Lyon");
  const [typeLocal, setTypeLocal] = useState("");
  const [surface, setSurface] = useState("60");
  const [rooms, setRooms] = useState("3");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PropertyReport | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const wantsValuation = typeLocal !== "" && surface.trim() !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = address.trim();
    if (!query || loading) return;

    const args: Record<string, unknown> = { address: query };
    if (typeLocal) args.type_local = typeLocal;
    const surfaceValue = Number(surface);
    if (surface.trim() !== "" && Number.isFinite(surfaceValue)) args.surface_m2 = surfaceValue;
    const roomsValue = Number(rooms);
    if (rooms.trim() !== "" && Number.isFinite(roomsValue)) args.rooms = roomsValue;

    setLoading(true);
    setError(null);
    setReport(null);
    setShowRaw(false);
    try {
      const res = await callTool("property_report", args);
      setDurationMs(res.durationMs ?? null);
      if (!res.ok || res.isError) {
        setError(res.error ?? res.text ?? "L'outil a renvoyé une erreur.");
      } else {
        setReport(res.data as PropertyReport);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const market = report?.market;
  const sales = report?.recent_sales_nearby;
  const valuation = report?.valuation;
  const rent = report?.rent;
  const propertyTax = report?.property_tax;
  const dpe = report?.energy_diagnostics;
  const risks = report?.risks;
  const commune = report?.commune;

  return (
    <>
      <Card title="Nouveau dossier" note="un appel à l'outil property_report">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field wide">
              <label className="lbl" htmlFor="address">
                Adresse en France <span className="hint">— n° + rue + ville, ou une commune entière</span>
              </label>
              <input
                id="address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 rue de la République, Lyon"
                autoComplete="off"
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="type">
                Type de bien <span className="hint">— requis pour l'estimation</span>
              </label>
              <select id="type" value={typeLocal} onChange={(e) => setTypeLocal(e.target.value)}>
                <option value="">— non précisé —</option>
                <option value="Appartement">Appartement</option>
                <option value="Maison">Maison</option>
              </select>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="surface">
                Surface habitable (m²)
              </label>
              <input
                id="surface"
                type="number"
                min={8}
                max={1000}
                value={surface}
                onChange={(e) => setSurface(e.target.value)}
                placeholder="60"
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="rooms">
                Pièces principales
              </label>
              <input
                id="rooms"
                type="number"
                min={1}
                max={20}
                value={rooms}
                onChange={(e) => setRooms(e.target.value)}
                placeholder="3"
              />
            </div>

            <div className="field">
              <button className="btn" type="submit" disabled={loading || !address.trim()}>
                {loading ? <Spinner /> : null}
                {loading ? "Analyse en cours…" : "Générer le dossier"}
              </button>
            </div>
          </div>
        </form>

        <div className="chips">
          {EXAMPLES.map((example) => (
            <button
              type="button"
              className="chip"
              key={example}
              onClick={() => setAddress(example)}
              disabled={loading}
            >
              {example}
            </button>
          ))}
        </div>

        {!wantsValuation ? (
          <div className="source-note">
            Sans type de bien ni surface, le rapport couvre le marché, les ventes, le DPE, les risques et la
            commune — mais pas l'estimation ni le rendement locatif.
          </div>
        ) : null}
      </Card>

      {error ? (
        <div style={{ marginTop: 16 }}>
          <Alert kind="error" title="Le dossier n'a pas pu être généré.">
            {error}
          </Alert>
        </div>
      ) : null}

      {loading ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="empty">
            Interrogation des API publiques (DVF, ADEME, Géorisques, BAN, INSEE) — comptez quelques
            secondes, davantage pour une commune entière.
          </div>
        </div>
      ) : null}

      {report ? (
        <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
          <div className="card">
            <div className="result-head">
              <strong style={{ color: "var(--text)" }}>{report.resolved_address ?? "Adresse résolue"}</strong>
              {durationMs !== null ? <span className="badge">{num(durationMs / 1000, 1)} s</span> : null}
              <span style={{ marginLeft: "auto" }}>
                <button className="btn ghost small" type="button" onClick={() => setShowRaw((v) => !v)}>
                  {showRaw ? "Masquer le JSON brut" : "Voir le JSON brut"}
                </button>
              </span>
            </div>
            {report.generated_from ? (
              <div className="card-body" style={{ paddingTop: 12, paddingBottom: 12 }}>
                <div className="source-note" style={{ marginTop: 0 }}>
                  {report.generated_from}
                </div>
              </div>
            ) : null}
          </div>

          {showRaw ? (
            <pre className="json">{JSON.stringify(report, null, 2)}</pre>
          ) : null}

          {valuation && !isErrorBlock(valuation) ? (
            <ValuationCard block={valuation as ValuationBlock} />
          ) : null}
          {valuation && isErrorBlock(valuation) ? (
            <SectionError name="Estimation" error={valuation.error} />
          ) : null}

          <div className="grid cols-2">
            {market && !isErrorBlock(market) ? <MarketCard block={market as MarketBlock} /> : null}
            {market && isErrorBlock(market) ? <SectionError name="Marché" error={market.error} /> : null}
            {rent && !isErrorBlock(rent) ? <RentCard block={rent as RentBlock} /> : null}
            {rent && isErrorBlock(rent) ? <SectionError name="Loyers" error={rent.error} /> : null}
            {propertyTax && !isErrorBlock(propertyTax) ? (
              <PropertyTaxCard block={propertyTax as PropertyTaxBlock} />
            ) : null}
            {propertyTax && isErrorBlock(propertyTax) ? (
              <SectionError name="Taxe foncière" error={propertyTax.error} />
            ) : null}
          </div>

          {sales && !isErrorBlock(sales) ? <SalesTable block={sales as SalesBlock} /> : null}
          {sales && isErrorBlock(sales) ? <SectionError name="Ventes" error={sales.error} /> : null}

          <div className="grid cols-2">
            {dpe && !isErrorBlock(dpe) ? <DpeCard block={dpe as DpeBlock} /> : null}
            {dpe && isErrorBlock(dpe) ? <SectionError name="DPE" error={dpe.error} /> : null}
            {risks && !isErrorBlock(risks) ? <RisksCard block={risks as RisksBlock} /> : null}
            {risks && isErrorBlock(risks) ? <SectionError name="Risques" error={risks.error} /> : null}
          </div>

          {commune && !isErrorBlock(commune) ? <CommuneCard block={commune as CommuneBlock} /> : null}
          {commune && isErrorBlock(commune) ? <SectionError name="Commune" error={commune.error} /> : null}
        </div>
      ) : null}
    </>
  );
}
