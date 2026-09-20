"use client";

import { useState } from "react";
import { compareDelta, rangeShortLabel, type GstBasis, type MetricKind, type MetricUnit, type Range } from "@/lib/reporting/core";

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
  display?: "tile" | "rows";
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


function cell(v: unknown, key: string): string {
  if (v == null) return "";
  if (typeof v === "number" && /cents$/.test(key)) return aud.format(v / 100);
  if (typeof v === "number") return num.format(v);
  return String(v);
}

export default function HomeTiles({ tiles: all }: { tiles: TileData[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** Session 6: the "i" on the tile itself — the definition without opening the rows. */
  const [tileInfo, setTileInfo] = useState<string | null>(null);
  const shownTile = all.find((t) => t.key === tileInfo) ?? null;
  const tiles = all.filter((t) => t.display !== "rows");
  const cards = all.filter((t) => t.display === "rows");
  const active = tiles.find((t) => t.key === open) ?? null;
  const cls = tiles.length === 3 ? "tiles three" : "tiles";

  return (
    <>
      {tiles.length > 0 && <div className={cls}>
        {tiles.map((t) => {
          const d = t.kind === "period" ? compareDelta(t.value, t.compare) : null;
          return (
            <div className="tilewrap" key={t.key}>
            <button
              type="button"
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
                  <span className={d.dir === "up" ? "up" : "down"}>{d.dir === "up" ? "▲" : "▼"} {d.pct}% vs {rangeShortLabel(t.compareRange)}</span>
                )}
                {d && d.dir === "flat" && <span>same as {rangeShortLabel(t.compareRange)}</span>}
                {t.kind === "period" && t.compare === 0 && t.value > 0 && <span>none in {rangeShortLabel(t.compareRange)}</span>}
              </div>
            </button>
            <button type="button" className="i" aria-pressed={tileInfo === t.key} aria-label={`What ${t.title} counts`} title="What this counts" onClick={() => setTileInfo(tileInfo === t.key ? null : t.key)} data-testid={`tile-info-${t.key}`}>i</button>
            </div>
          );
        })}
      </div>}
      {shownTile && (
        <p className="note tiledef" data-testid={`tile-definition-${shownTile.key}`}>
          <b>{shownTile.title}</b>{shownTile.kind === "now" ? " · right now" : " · moves with the period"}{shownTile.gst ? ` · ${shownTile.gst === "inc" ? "inc GST" : "ex GST"}` : ""} — {shownTile.definition}
        </p>
      )}

      {cards.length > 0 && (
        <div className="grid2">
          {cards.map((c) => (
            <div className="card" key={c.key} data-testid={`rows-${c.key}`}>
              <h2 style={{ fontSize: 15 }}>{c.title} <em>{c.note ?? ""}</em>
                <button type="button" className="ex" aria-pressed={info === c.key} onClick={() => setInfo(info === c.key ? null : c.key)} data-testid={`info-${c.key}`} title="What this counts">i</button>
                <a className="ex" href={c.exportHref} data-testid={`export-${c.key}`}>Export CSV</a>
              </h2>
              {info === c.key && <p className="note" data-testid={`definition-${c.key}`}>{c.definition}</p>}
              <div className="rows">
                {c.rows.length === 0 && <p className="note">Nothing in this range.</p>}
                {c.rows.map((r, i) => {
                  const [first, ...rest] = c.columns;
                  const money = c.columns.find((col) => /cents$/.test(col.key) && col.key !== first.key);
                  const sub = rest.filter((col) => col !== money).slice(0, 3).map((col) => `${cell(r[col.key], col.key)}${/pct$/.test(col.key) ? "%" : ""} ${col.label.replace(/ \(.*\)$/, "").toLowerCase()}`).join(" · ");
                  return (
                    <div className="row" key={i} data-testid={`row-${c.key}-${i}`}>
                      <div>{String(r[first.key] ?? "")}<div className="sub">{sub}</div></div>
                      {money && <div className="val">{cell(r[money.key], money.key)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

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
