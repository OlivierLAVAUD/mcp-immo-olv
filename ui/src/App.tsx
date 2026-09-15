import { useEffect, useState } from "react";
import { getHealth } from "./api";
import type { Health } from "./types";
import DossierTab from "./tabs/DossierTab";
import ToolConsoleTab from "./tabs/ToolConsoleTab";

type TabId = "dossier" | "tools";

export default function App() {
  const [tab, setTab] = useState<TabId>("dossier");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => {
        if (!alive) return;
        setHealth(h);
        setHealthError(h.ok ? null : (h.error ?? "session MCP indisponible"));
      })
      .catch((e: unknown) => {
        if (alive) setHealthError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const online = health?.ok === true && !healthError;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">im</div>
            <div>
              <h1>OLV Immo — console</h1>
              <p className="sub">
                Serveur MCP immobilier français, interrogé en direct sur l'open data officiel
              </p>
            </div>
            <div className="brand-spacer" />
            <span className="health" title={health?.serverEntry ?? undefined}>
              <span className={online ? "dot ok" : healthError ? "dot bad" : "dot"} />
              {online
                ? `MCP connecté · ${health?.toolCount ?? 0} outils`
                : healthError
                  ? "MCP indisponible"
                  : "connexion…"}
            </span>
          </div>

          <nav className="tabs" role="tablist" aria-label="Sections">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "dossier"}
              onClick={() => setTab("dossier")}
            >
              Dossier
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "tools"}
              onClick={() => setTab("tools")}
            >
              Outils MCP
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        {healthError ? (
          <div className="alert error" style={{ marginBottom: 16 }}>
            <div>
              <div className="alert-title">Le pont HTTP ne parvient pas à joindre le serveur MCP.</div>
              <div style={{ marginTop: 4 }}>{healthError}</div>
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                Vérifiez que le serveur est compilé (<span className="mono">npm run build</span> à la
                racine du dépôt) et que le pont tourne (<span className="mono">npm run bridge</span>).
              </div>
            </div>
          </div>
        ) : null}

        {tab === "dossier" ? <DossierTab /> : <ToolConsoleTab />}
      </main>
    </div>
  );
}
