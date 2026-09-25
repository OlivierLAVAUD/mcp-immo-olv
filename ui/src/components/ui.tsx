import type { ReactNode } from "react";

export function Card({
  title,
  note,
  children,
  tight = false,
  actions,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions}
        {note ? <div className="head-note">{note}</div> : null}
      </header>
      <div className={tight ? "card-body tight" : "card-body"}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  small = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  small?: boolean;
}) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className={small ? "v sm" : "v"}>
        {value}
        {unit ? <span className="u"> {unit}</span> : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Alert({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn" | "error";
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`alert ${kind}`}>
      <div>
        {title ? <div className="alert-title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ dark = false }: { dark?: boolean }) {
  return <span className={dark ? "spinner dark" : "spinner"} aria-hidden="true" />;
}

export function SectionError({ name, error }: { name: string; error: string }) {
  return (
    <div className="section-error">
      <strong>{name}</strong> — cette section a échoué : {error}
    </div>
  );
}

/** Official A–G colour scale, shared by DPE and GES labels. */
const LABEL_COLORS: Record<string, string> = {
  A: "#00a34a",
  B: "#4cb04f",
  C: "#c3d200",
  D: "#f7d117",
  E: "#f59e0b",
  F: "#ef6c00",
  G: "#c62828",
};

export function LabelChip({ value }: { value?: string }) {
  const letter = (value ?? "").trim().toUpperCase().slice(0, 1);
  const color = LABEL_COLORS[letter];
  if (!color) {
    return <span className="dpe na" title="Non renseigné">{value || "—"}</span>;
  }
  return (
    <span className="dpe" style={{ background: color }} title={`Étiquette ${letter}`}>
      {letter}
    </span>
  );
}

/** A horizontal range bar showing low / estimate / high. */
export function RangeBar({
  low,
  estimate,
  high,
  format,
}: {
  low: number;
  estimate: number;
  high: number;
  format: (v: number) => string;
}) {
  const span = Math.max(high - low, 1);
  const pad = span * 0.28;
  const min = low - pad;
  const max = high + pad;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="range-bar">
      <div className="range-track">
        <div
          className="range-fill"
          style={{ left: `${pos(low)}%`, width: `${Math.max(pos(high) - pos(low), 1.5)}%` }}
        />
        <div className="range-marker" style={{ left: `calc(${pos(estimate)}% - 1.5px)` }} />
      </div>
      <div className="range-legend">
        <span>{format(low)}</span>
        <span>{format(high)}</span>
      </div>
    </div>
  );
}
