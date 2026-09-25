import { useEffect, useMemo, useState } from "react";
import { callTool, getTools } from "../api";
import { Alert, Card, Empty, Spinner } from "../components/ui";
import { num } from "../format";
import { effective, emptyValues, kindOf, missingRequired, toArguments } from "../schema";
import type { FieldValue, FormValues } from "../schema";
import type { CallResult, JsonSchemaProp, ToolInfo } from "../types";

function FieldInput({
  name,
  prop,
  required,
  value,
  onChange,
}: {
  name: string;
  prop: JsonSchemaProp;
  required: boolean;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  const p = effective(prop);
  const kind = kindOf(prop);
  const id = `arg-${name}`;
  const label = (
    <label className="lbl" htmlFor={id}>
      <span className="mono">{name}</span>
      {required ? <span style={{ color: "var(--bad)" }}> *</span> : null}
      {p.description ? <span className="hint"> — {p.description}</span> : null}
    </label>
  );

  if (kind === "enum") {
    return (
      <div className="field">
        {label}
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— non précisé —</option>
          {(p.enum ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (kind === "boolean") {
    return (
      <div className="field">
        {label}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span>{value ? "vrai" : "faux"}</span>
        </label>
      </div>
    );
  }

  const placeholder =
    kind === "array"
      ? effective(p.items ?? {}).type === "number"
        ? "2023, 2024"
        : "valeur, valeur"
      : kind === "number"
        ? p.minimum !== undefined
          ? `≥ ${p.minimum}`
          : "nombre"
        : "texte";

  return (
    <div className="field">
      {label}
      <input
        id={id}
        type={kind === "number" ? "number" : "text"}
        value={String(value ?? "")}
        placeholder={placeholder}
        min={kind === "number" ? p.minimum : undefined}
        max={kind === "number" ? p.maximum : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Raw tool explorer. `initialTools` lets the render smoke test drive this tab
 * with the schemas captured from the real server; in the browser the list is
 * always (re)fetched from the bridge.
 */
export default function ToolConsoleTab({ initialTools }: { initialTools?: ToolInfo[] }) {
  const [tools, setTools] = useState<ToolInfo[]>(initialTools ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(() => initialTools?.[0]?.name ?? null);
  const [values, setValues] = useState<FormValues>({});
  const [rawArgs, setRawArgs] = useState("{}");
  const [rawError, setRawError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);

  useEffect(() => {
    let alive = true;
    getTools()
      .then((list) => {
        if (!alive) return;
        setTools(list);
        setSelected((current) => current ?? list[0].name);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const tool = useMemo(() => tools.find((t) => t.name === selected) ?? null, [tools, selected]);

  // Reset the form whenever the selected tool changes.
  useEffect(() => {
    if (!tool) return;
    const initial = emptyValues(tool.inputSchema);
    setValues(initial);
    setRawArgs(JSON.stringify(toArguments(initial, tool.inputSchema), null, 2));
    setRawError(null);
    setResult(null);
  }, [tool]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.title ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [tools, filter]);

  function updateValue(name: string, value: FieldValue) {
    if (!tool) return;
    const next = { ...values, [name]: value };
    setValues(next);
    setRawArgs(JSON.stringify(toArguments(next, tool.inputSchema), null, 2));
    setRawError(null);
  }

  function onRawChange(text: string) {
    setRawArgs(text);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      setRawError(null);
      const merged: FormValues = { ...values };
      for (const [k, v] of Object.entries(parsed)) {
        merged[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : (v as FieldValue);
      }
      setValues(merged);
    } catch (e: unknown) {
      setRawError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!tool || running) return;
    let args: Record<string, unknown>;
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch (e: unknown) {
      setRawError(e instanceof Error ? e.message : String(e));
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      setResult(await callTool(tool.name, args));
    } catch (e: unknown) {
      setResult({
        ok: false,
        tool: tool.name,
        error: e instanceof Error ? e.message : String(e),
        durationMs: null,
      });
    } finally {
      setRunning(false);
    }
  }

  if (loadError) {
    return (
      <Alert kind="error" title="Impossible de charger la liste des outils.">
        {loadError}
      </Alert>
    );
  }

  const required = new Set(tool?.inputSchema?.required ?? []);
  const properties = Object.entries(tool?.inputSchema?.properties ?? {});
  const missing = tool ? missingRequired(values, tool.inputSchema) : [];

  return (
    <div className="tools-layout">
      <Card title="Outils exposés" note={tools.length > 0 ? `${tools.length}` : undefined} tight>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer…"
            aria-label="Filtrer les outils"
          />
        </div>
        <div className="tool-list">
          {visible.length === 0 ? (
            <Empty>
              {tools.length === 0 ? (
                <>
                  Chargement… <Spinner dark />
                </>
              ) : (
                "Aucun outil ne correspond."
              )}
            </Empty>
          ) : (
            visible.map((t) => (
              <button
                type="button"
                className="tool-item"
                key={t.name}
                aria-current={t.name === selected}
                onClick={() => setSelected(t.name)}
              >
                <div className="name">{t.name}</div>
                {t.title ? <div className="title">{t.title}</div> : null}
              </button>
            ))
          )}
        </div>
      </Card>

      {!tool ? (
        <Card title="Outil">
          <Empty>Sélectionnez un outil à gauche.</Empty>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Card title={tool.title ?? tool.name} note={<span className="mono">{tool.name}</span>}>
            {tool.description ? (
              <p style={{ marginTop: 0, color: "var(--text-soft)" }}>{tool.description}</p>
            ) : null}

            {properties.length === 0 ? (
              <Empty>Cet outil ne prend aucun argument.</Empty>
            ) : (
              <div className="form-grid">
                {properties.map(([name, prop]) => (
                  <FieldInput
                    key={name}
                    name={name}
                    prop={prop}
                    required={required.has(name)}
                    value={values[name] ?? ""}
                    onChange={(v) => updateValue(name, v)}
                  />
                ))}
              </div>
            )}

            {missing.length > 0 ? (
              <div className="source-note" style={{ marginTop: 14 }}>
                Requis non renseigné : <span className="mono">{missing.join(", ")}</span>. L'appel partira
                quand même — le serveur répondra par une erreur exploitable.
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
              <button className="btn" type="button" onClick={run} disabled={running}>
                {running ? <Spinner /> : null}
                {running ? "Appel en cours…" : "Appeler l'outil"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  const initial = emptyValues(tool.inputSchema);
                  setValues(initial);
                  setRawArgs(JSON.stringify(toArguments(initial, tool.inputSchema), null, 2));
                  setRawError(null);
                  setResult(null);
                }}
                disabled={running}
              >
                Réinitialiser
              </button>
            </div>
          </Card>

          <Card title="Arguments JSON" note="éditable — la forme et ce bloc restent synchronisés">
            <textarea
              value={rawArgs}
              spellCheck={false}
              onChange={(e) => onRawChange(e.target.value)}
              aria-label="Arguments JSON"
            />
            {rawError ? (
              <div style={{ marginTop: 10 }}>
                <Alert kind="warn" title="JSON invalide">
                  {rawError}
                </Alert>
              </div>
            ) : null}
          </Card>

          {result ? (
            <Card
              title="Réponse"
              note={
                <>
                  {result.ok ? (
                    <span className="badge good">succès</span>
                  ) : (
                    <span className="badge bad">erreur</span>
                  )}{" "}
                  {result.durationMs !== null && result.durationMs !== undefined
                    ? `${num(result.durationMs / 1000, 2)} s`
                    : null}
                </>
              }
            >
              {!result.ok && result.error ? (
                <div style={{ marginBottom: 12 }}>
                  <Alert kind="error">{result.error}</Alert>
                </div>
              ) : null}
              <pre className="json">
                {JSON.stringify(result.data ?? result.text ?? result.error ?? null, null, 2)}
              </pre>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
