/**
 * The remittance advice — Paint Group telling the contractor "we've paid you":
 * amount, date, bank reference, and the make-up of the figure (offer +
 * variations − deductions). Same self-contained white A4 pattern as the
 * receipt (receiptHtml.ts); rendered straight to PDF, no route behind it.
 * The GST line follows what was pinned at submission — an unregistered
 * contractor's remittance shows no GST component.
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = (cents: number) =>
  "$" + (Math.abs(cents) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type RemittanceDeduction = { label?: string; cents?: number; note?: string; manual?: boolean };

export function buildRemittanceHtml(opts: {
  remittanceNumber: string;
  ciNumber: string;
  totalIncCents: number;
  gstCents: number;
  offerCents: number;
  additionsCents: number;
  deductionLines: RemittanceDeduction[];
  paidOn: string | null; // yyyy-mm-dd
  bankReference: string;
  contractor: { company_name?: string; abn?: string; address?: string; bank_bsb?: string; bank_last4?: string };
  woRef: string;
  jobTitle: string;
  entity: Record<string, string>;
  /** Approved expense reimbursements this payment covered — itemised at
   *  cost (6c, ⚑A4: GST treatment with the accountant). */
  reimbursementLines?: { label?: string; cents?: number }[];
}): string {
  const date = opts.paidOn
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(opts.paidOn + "T00:00:00Z"))
    : "";
  const name = esc(opts.entity.tradingName || "Paint Group");
  const deductions = (opts.deductionLines ?? []).filter((d) => (d.cents ?? 0) > 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Switzer',system-ui,-apple-system,sans-serif;color:#111417;background:#fff;
    font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .mono{font-family:'Martian Mono',ui-monospace,SFMono-Regular,monospace}
  .sheet{max-width:720px;margin:0 auto;padding:8px 4px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
    border-bottom:3px solid #111417;padding-bottom:18px}
  .wordmark{font-size:22px;font-weight:700;letter-spacing:.12em}
  .wordmark span{color:#0E8296}
  .tagline{font-family:'Martian Mono',monospace;font-size:8px;letter-spacing:.18em;
    text-transform:uppercase;color:#6B7480;margin-top:4px}
  .entity{font-size:11px;color:#4A525B;margin-top:10px;line-height:1.6}
  .doctype{text-align:right}
  .doctype h1{font-size:19px;font-weight:700;letter-spacing:.08em}
  .doctype .num{font-family:'Martian Mono',monospace;font-size:13px;margin-top:6px}
  .doctype .date{font-size:11.5px;color:#4A525B;margin-top:4px}
  .grid{display:flex;gap:32px;margin-top:20px}
  .grid .k{font-family:'Martian Mono',monospace;font-size:8px;letter-spacing:.14em;
    text-transform:uppercase;color:#6B7480;margin-bottom:4px}
  .grid .v{font-size:13px;font-weight:600}
  .grid .v small{display:block;font-weight:400;color:#4A525B;font-size:11.5px}
  table{width:100%;border-collapse:collapse;margin-top:22px}
  th{font-family:'Martian Mono',monospace;font-size:8px;letter-spacing:.12em;text-transform:uppercase;
    color:#6B7480;text-align:left;padding:0 0 8px;border-bottom:1.5px solid #111417}
  th.r,td.r{text-align:right}
  td{padding:10px 0;border-bottom:1px solid #E3E6E9;font-size:13px}
  td small{display:block;color:#6B7480;font-size:11px}
  .totals{margin-top:16px;margin-left:auto;width:300px}
  .trow{display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px;color:#4A525B}
  .trow b{color:#111417;font-weight:600;font-family:'Martian Mono',monospace;font-size:12px}
  .trow.big{border-top:2px solid #111417;margin-top:6px;padding-top:9px;font-size:14px;color:#111417;font-weight:700}
  .trow.big b{font-size:15px}
  .note{margin-top:26px;background:#F4F6F7;border-radius:8px;padding:13px 16px;font-size:12px;color:#4A525B}
  .foot{margin-top:30px;padding-top:12px;border-top:1px solid #E3E6E9;font-size:10.5px;color:#6B7480;
    display:flex;justify-content:space-between;gap:16px}
</style></head><body>
<div class="sheet">
  <div class="top">
    <div>
      <div class="wordmark">PAINT<span>GROUP</span></div>
      ${opts.entity.brandSub ? `<div class="tagline">${esc(opts.entity.brandSub)}</div>` : ""}
      <div class="entity">${esc(opts.entity.address || "")}<br>ABN ${esc(opts.entity.abn || "")}</div>
    </div>
    <div class="doctype">
      <h1>REMITTANCE ADVICE</h1>
      <div class="num mono">${esc(opts.remittanceNumber)}</div>
      <div class="date">${esc(date)}</div>
    </div>
  </div>

  <div class="grid">
    <div><div class="k">Paid to</div><div class="v">${esc(opts.contractor.company_name || "—")}<small>ABN ${esc(opts.contractor.abn || "")}${opts.contractor.address ? " · " + esc(opts.contractor.address) : ""}</small></div></div>
    <div><div class="k">Against invoice</div><div class="v mono">${esc(opts.ciNumber)}<small>${esc(opts.woRef)}${opts.jobTitle ? " · " + esc(opts.jobTitle) : ""}</small></div></div>
    <div><div class="k">Paid into</div><div class="v mono">BSB ${esc(opts.contractor.bank_bsb || "")}<small>Account ····${esc(opts.contractor.bank_last4 || "")}</small></div></div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
    <tbody>
      <tr><td>Contract work — ${esc(opts.woRef)}</td><td class="r mono">${money(opts.offerCents)}</td></tr>
      ${opts.additionsCents > 0 ? `<tr><td>Approved variations</td><td class="r mono">${money(opts.additionsCents)}</td></tr>` : ""}
      ${deductions.map((d) => `<tr><td>Less — ${esc(d.label ?? "scope removed")}${d.note ? `<small>${esc(d.note)}</small>` : ""}</td><td class="r mono">−${money(d.cents ?? 0)}</td></tr>`).join("")}
      ${(opts.reimbursementLines ?? []).filter((l) => (l.cents ?? 0) > 0).map((l) => `<tr><td>${esc(l.label ?? "Reimbursement")}<small>at cost — approved expense</small></td><td class="r mono">${money(l.cents ?? 0)}</td></tr>`).join("")}
    </tbody>
  </table>

  <div class="totals">
    <div class="trow big"><span>Total paid</span><b>${money(opts.totalIncCents)}</b></div>
    ${opts.gstCents > 0 ? `<div class="trow"><span>Includes GST of</span><b>${money(opts.gstCents)}</b></div>` : `<div class="trow"><span>No GST component</span><b>—</b></div>`}
    ${opts.bankReference ? `<div class="trow"><span>Bank reference</span><b>${esc(opts.bankReference)}</b></div>` : ""}
  </div>

  <div class="note">This payment has been made to the account above. Please keep this advice with your records — it reconciles against your invoice ${esc(opts.ciNumber)}.</div>

  <div class="foot">
    <span>${name} · ABN ${esc(opts.entity.abn || "")}</span>
    <span class="mono">${esc(opts.remittanceNumber)}</span>
  </div>
</div>
</body></html>`;
}
