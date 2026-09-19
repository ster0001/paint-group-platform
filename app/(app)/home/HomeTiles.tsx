"use client";

import { useState } from "react";
import { compareDelta, type GstBasis, type MetricKind, type MetricUnit, type Range } from "@/lib/reporting/core";

/**
 * Session 1 — the stat tiles of one section (mockup `.tiles` / `.tile`).
 * A tile is a button: press it and its rows open beneath, with the "i"
 * definition and the Export CSV link (the one route). "right now" tiles say
 * so; period tiles carry the comparison arrow. Money is formatted here, at
 * the display edge, from integer cents.
 */
export type TileData = {
  key: string;
  kind: MetricKind;
  title: string;
  definition: string;
  unit: MetricUnit;
  gst: GstBasis;
  value: number;
  compare: number | null;
  compareRange: Range | null;
  note: string | null;
  href?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  exportHref: string;
};

const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-AU");

export function formatValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "cents": return aud.format(Math.round(value) / 100);
    case "pct": return `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}%`;
    case "days": return `${num.format(Math.round(value * 10) / 10)} d`;
    case "hours": return `${num.format(Math.round(value * 10) / 10)} h`;
    default: return num.format(value);
  }
}

const monthShort = (r: Range | null) => (r ? new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" }).format(new Date(`${r.from}T00:00:00Z`)) : "");

function cell(v: unknown, key: string): string {
  if (v == null) return "";
  if (typeof v === "number" && /cents$/.test(key)) return aud.format(v / 100);
  if (typeof v === "number") return num.format(v);
  return String(v);
}

export default function HomeTiles({ tiles }: { tiles: TileData[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const active = tiles.find((t) => t.key === open) ?? null;
  const cls = tiles.length === 3 ? "tiles three" : "tiles";

  return (
    <>
      <div className={cls}>
        {tiles.map((t) => {
          const d = t.kind === "period" ? compareDelta(t.value, t.compare) : null;
          return (
            <button
              key={t.key} type="button"
              className={`tile${t.kind === "now" ? " now" : ""}${open === t.key ? " open" : ""}`}
              aria-pressed={open === t.key}
              onClick={() => setOpen(open === t.key ? null : t.key)}
              data-testid={`tile-${t.key}`}
            >
              <span className="arrow" aria-hidden="true">›</span>
              <div className="l">{t.title}</div>
              <div className="v" data-testid={`tile-value-${t.key}`}>{formatValue(t.value, t.unit)}</div>
              <div className="d">
                {t.note && <span data-testid={`tile-note-${t.key}`}>{t.note}</span>}
                {t.gst && <span>{t.gst === "inc" ? "inc GST" : "ex GST"}</span>}
                {d && d.dir !== "flat" && (
                  <span className={d.dir === "up" ? "up" : "down"}>{d.dir === "up" ? "▲" : "▼"} {d.pct}% vs {monthShort(t.compareRange)}</span>
                )}
                {d && d.dir === "flat" && <span>same as {monthShort(t.compareRange)}</span>}
                {t.kind === "period" && t.compare === 0 && t.value > 0 && <span>none in {monthShort(t.compareRange)}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="card drill" data-testid={`drill-${active.key}`}>
          <div className="drill-head">
            <b>{active.title}</b>
            <span className="mono">{active.rowCount} row{active.rowCount === 1 ? "" : "s"}{active.rowCount > active.rows.length ? ` · showing ${active.rows.length}` : ""}</span>
            <button type="button" className="ex" aria-pressed={info === active.key} onClick={() => setInfo(info === active.key ? null : active.key)} data-testid={`info-${active.key}`} title="What this counts">i</button>
            <a className="ex" href={active.exportHref} data-testid={`export-${active.key}`}>Export CSV</a>
            {active.href && <a className="ex" href={active.href}>Open list</a>}
          </div>
          {info === active.key && <p className="note" data-testid={`definition-${active.key}`}>{active.definition}</p>}
          {active.rows.length === 0 ? (
            <p className="note">Nothing in this range.</p>
          ) : (
            <div className="rows" style={{ overflowX: "auto" }}>
              <table className="drill-table">
                <thead><tr>{active.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {active.rows.map((r, i) => (
                    <tr key={i}>{active.columns.map((c) => <td key={c.key} className={/cents$/.test(c.key) ? "mono r" : ""}>{cell(r[c.key], c.key)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
