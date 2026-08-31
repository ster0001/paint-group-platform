/**
 * Session 6 · The portfolio statement (§5.6) as a white A4 document —
 * rendered from the SAME TradeMoneyView the screen and CSV use, so the
 * three can never disagree. No client maths, no trade pricing beyond the
 * invoices themselves.
 */
import type { TradeMoneyView } from "./tradeMoney";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildStatementHtml(opts: {
  view: TradeMoneyView;
  orgName: string;
  companyName: string;
  companyPhone?: string;
  logoUrl?: string;
  dateLabel: string;
}): string {
  const { view } = opts;
  const rows = view.groups.map((g) => `
    <tr class="group"><td colspan="6"><b>${esc(g.address)}</b>${g.refLine ? ` <span class="refs">${esc(g.refLine)}</span>` : ""}</td></tr>
    ${g.rows.map((r) => `
      <tr>
        <td>${esc(r.number ?? "")}</td>
        <td>${esc(r.kind)}</td>
        <td>${esc(r.issuedOn ?? "")}</td>
        <td>${esc(r.dueOn ?? "")}</td>
        <td class="num">${money(r.totalIncCents)}</td>
        <td class="num">${r.balanceCents === 0 ? "Paid" : r.overdue ? `<b class="over">${money(r.balanceCents)} overdue</b>` : money(r.balanceCents)}</td>
      </tr>`).join("")}
  `).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #16181b; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    .head img { max-height: 42px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .sub { color: #5a6067; }
    .tiles { display: flex; gap: 24px; margin: 14px 0 18px; }
    .tile b { font-size: 16px; display: block; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 6px 8px; border-bottom: 1px solid #e3e6e9; text-align: left; vertical-align: top; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5a6067; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.group td { background: #f4f6f8; padding-top: 10px; }
    .refs { color: #5a6067; font-size: 11px; margin-left: 8px; }
    .over { color: #a33d2e; }
    .foot { margin-top: 20px; color: #5a6067; font-size: 11px; }
  </style></head><body>
    <div class="head">
      <div>
        <h1>Statement — ${esc(opts.orgName)}</h1>
        <div class="sub">${esc(opts.dateLabel)} · all amounts inc GST</div>
      </div>
      ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="${esc(opts.companyName)}">` : `<b>${esc(opts.companyName)}</b>`}
    </div>
    <div class="tiles">
      <div class="tile"><b>${money(view.outstandingCents)}</b>Outstanding · ${view.outstandingCount} invoice${view.outstandingCount === 1 ? "" : "s"}</div>
      <div class="tile"><b>${money(view.overdueCents)}</b>Overdue · ${view.overdueCount} invoice${view.overdueCount === 1 ? "" : "s"}</div>
    </div>
    <table>
      <thead><tr><th>Invoice</th><th>Type</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">Nothing invoiced yet.</td></tr>`}</tbody>
    </table>
    <div class="foot">${esc(opts.companyName)}${opts.companyPhone ? ` · ${esc(opts.companyPhone)}` : ""} — questions about any line, just call.</div>
  </body></html>`;
}
