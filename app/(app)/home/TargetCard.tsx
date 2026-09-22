"use client";

import { useState } from "react";
import type { TargetCardData } from "@/lib/reporting/metrics/target";

/**
 * Session 3 — the target card (mockup `.target`): the month's sales against
 * the Settings target with a pace marker, and twelve months of actual vs
 * target as bars. One measure, one axis (dollars); two series (target,
 * actual) so a legend is present; the actual bars are the deeper paint tone
 * for contrast, the target bars the raised surface behind them; the current
 * month and the peak are direct-labelled; every bar has a hover tooltip; the
 * table view is the "Show as table" toggle. A month with no target reads
 * "no target set", never 0%.
 */
const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const short = (cents: number) => (cents >= 100_000_00 ? `$${Math.round(cents / 100_000_00 * 10) / 10}m` : cents >= 100_000 ? `$${Math.round(cents / 100_000)}k` : aud.format(cents / 100));

export default function TargetCard({ data }: { data: TargetCardData }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const W = 300, H = 110, PAD_TOP = 14, PAD_BOTTOM = 18, gap = 6;
  const bw = (W - gap * (data.months.length - 1)) / data.months.length;
  const max = Math.max(1, ...data.months.flatMap((m) => [m.sales_cents, m.target_cents ?? 0]));
  const y = (v: number) => H - PAD_BOTTOM - (v / max) * (H - PAD_TOP - PAD_BOTTOM);
  const peak = data.months.reduce((p, m, i) => (m.sales_cents > data.months[p].sales_cents ? i : p), 0);
  const last = data.months.length - 1;

  return (
    <div className="card" data-testid="target-card">
      <h2 style={{ fontSize: 15 }}>{data.label} target <em>set in Settings</em>
        <button type="button" className="ex" aria-pressed={table} onClick={() => setTable(!table)} data-testid="target-table-toggle">{table ? "Show as chart" : "Show as table"}</button>
      </h2>
      <div className="target">
        <div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)" }} data-testid="target-figure">
            {aud.format(data.sales_cents / 100)}{" "}
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>
              {data.target_cents != null ? `of ${aud.format(data.target_cents / 100)}` : "· no target set"}
            </span>
          </div>
          {data.target_cents != null ? (
            <>
              <div className="tbar"><i style={{ width: `${Math.min(100, data.pct_hit ?? 0)}%` }} /><b style={{ left: `${data.pct_month_gone}%` }} title="Where the month should be today" /></div>
              <div className="tlab"><span data-testid="target-pct">{data.pct_hit}% hit</span><span>{data.pct_month_gone}% of month gone · {data.pace}</span></div>
            </>
          ) : (
            <p className="note" data-testid="target-none">Set a target for {data.label} under Settings → Dashboard to see the pace.</p>
          )}
          <p className="note" data-testid="target-fy">
            <b>{data.fy_label} so far:</b> {aud.format(data.fy_sales_cents / 100)}
            {data.fy_target_cents != null ? ` of ${aud.format(data.fy_target_cents / 100)} (${data.fy_months_with_target} month${data.fy_months_with_target === 1 ? "" : "s"} with a target)` : " · no targets set this financial year"}
          </p>
        </div>
        <div>
          {table ? (
            <table className="drill-table" data-testid="target-table">
              <thead><tr><th>Month</th><th>Accepted</th><th>Sales</th><th>Target</th></tr></thead>
              <tbody>{data.months.map((m) => <tr key={m.month}><td>{m.label}</td><td>{m.accepted}</td><td className="mono r">{aud.format(m.sales_cents / 100)}</td><td className="mono r">{m.target_cents != null ? aud.format(m.target_cents / 100) : "—"}</td></tr>)}</tbody>
            </table>
          ) : (
            <div style={{ position: "relative" }}>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Twelve months of target versus actual sales" data-testid="target-chart">
                {data.months.map((m, i) => {
                  const x = i * (bw + gap);
                  return (
                    <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                      <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
                      {m.target_cents != null && <rect x={x} y={y(m.target_cents)} width={bw} height={Math.max(0, H - PAD_BOTTOM - y(m.target_cents))} rx={3} fill="var(--raised)" />}
                      {!m.future && <rect x={x + 2} y={y(m.sales_cents)} width={Math.max(0, bw - 4)} height={Math.max(0, H - PAD_BOTTOM - y(m.sales_cents))} rx={3} fill={m.recorded ? "var(--paint)" : "var(--paint-deep)"} opacity={hover == null || hover === i ? 1 : 0.55} />}
                      {(i === last || i === peak) && m.sales_cents > 0 && (
                        <text x={x + bw / 2} y={y(m.sales_cents) - 4} textAnchor="middle" fontSize="8.5" fill="var(--text)" fontFamily="var(--mono)">{short(m.sales_cents)}</text>
                      )}
                      <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize="7.5" fill="var(--muted)" fontFamily="var(--mono)">{m.label.split(" ")[0]}</text>
                    </g>
                  );
                })}
              </svg>
              {hover != null && (
                <div className="tip" role="status">
                  <b>{data.months[hover].label}</b> · {data.months[hover].future ? "still ahead" : `${aud.format(data.months[hover].sales_cents / 100)} from ${data.months[hover].accepted} accepted${data.months[hover].recorded ? " · recorded from PaintScout" : ""}`}
                  {data.months[hover].target_cents != null ? ` · target ${aud.format((data.months[hover].target_cents ?? 0) / 100)}` : " · no target"}
                </div>
              )}
              <div className="legend"><span><i style={{ background: "var(--raised)", border: "1px solid var(--line)" }} />Target</span><span><i style={{ background: "var(--paint-deep)" }} />Actual</span>{data.months.some((m) => m.recorded) && <span><i style={{ background: "var(--paint)" }} />Recorded (PaintScout)</span>}<span>{data.fy_label} · {data.months[0].label} → {data.months[last].label}</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
