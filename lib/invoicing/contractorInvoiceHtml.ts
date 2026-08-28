import { moneyAbs as money } from "@/lib/format/money";
/**
 * The contractor's invoice TO Paint Group — rendered under THEIR company
 * details (entity snapshot pinned at submission), headed "TAX INVOICE" only
 * when they were GST-registered at that moment. Same self-contained white A4
 * pattern as the receipt/remittance. A claim shows its one line; the sign-off
 * final shows the make-up (offer + variations − deductions − previously
 * invoiced).
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


export type CiPdfDeduction = { label?: string; cents?: number; note?: string };

export function buildContractorInvoiceHtml(opts: {
  heading: string; // "TAX INVOICE" | "INVOICE" — a legal statement, pinned
  number: string;
  submittedOn: string | null; // yyyy-mm-dd
  dueOn: string | null;
  contractor: { company_name?: string; abn?: string; address?: string; bank_bsb?: string; bank_last4?: string };
  billTo: Record<string, string>; // Paint Group entity settings
  woRef: string;
  jobTitle: string;
  source: string; // 'signoff' | 'claim'
  claimPct: number | null;
  /** The contractor's OWN line items (Tom, 25 Aug) — when present on a
   *  claim they replace the single computed line; they always sum to the
   *  claim total (server-enforced at submit). */
  customLines?: { label?: string; cents?: number }[];
  /** Their chosen invoice date (falls back to the submitted date). */
  invoiceDate?: string | null;
  /** Approved expense reimbursements riding this invoice — at cost,
   *  clearly labelled, itemised on the remittance too (6c, ⚑A4). */
  reimbursementLines?: { label?: string; cents?: number }[];
  offerCents: number;
  additionsCents: number;
  deductionLines: CiPdfDeduction[];
  previouslyInvoicedCents: number;
  subtotalExCents: number;
  gstCents: number;
  totalIncCents: number;
}): string {
  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
          .format(new Date(iso.slice(0, 10) + "T00:00:00Z"))
      : "";
  const deductions = (opts.deductionLines ?? []).filter((d) => (d.cents ?? 0) > 0);
  const isClaim = opts.source === "claim";

  const customLines = (opts.customLines ?? []).filter((l) => (l.cents ?? 0) > 0);
  const lines = isClaim
    ? customLines.length > 0
      ? customLines.map((l) =>
          `<tr><td>${esc(l.label ?? "Work performed")}<small>${esc(opts.woRef)}${opts.jobTitle ? ` · ${esc(opts.jobTitle)}` : ""}</small></td><td class="r mono">${money(l.cents ?? 0)}</td></tr>`,
        ).join("")
      : `<tr><td>Progress payment claim — ${esc(opts.woRef)}${opts.claimPct ? ` (${Number(opts.claimPct)}% of contract)` : ""}${opts.jobTitle ? `<small>${esc(opts.jobTitle)}</small>` : ""}</td><td class="r mono">${money(opts.totalIncCents)}</td></tr>`
    : [
        `<tr><td>Contract work — ${esc(opts.woRef)}${opts.jobTitle ? `<small>${esc(opts.jobTitle)}</small>` : ""}</td><td class="r mono">${money(opts.offerCents)}</td></tr>`,
        opts.additionsCents > 0 ? `<tr><td>Approved variations</td><td class="r mono">${money(opts.additionsCents)}</td></tr>` : "",
        ...deductions.map((d) => `<tr><td>Less — ${esc(d.label ?? "scope removed")}${d.note ? `<small>${esc(d.note)}</small>` : ""}</td><td class="r mono">−${money(d.cents ?? 0)}</td></tr>`),
        opts.previouslyInvoicedCents > 0 ? `<tr><td>Less previously invoiced</td><td class="r mono">−${money(opts.previouslyInvoicedCents)}</td></tr>` : "",
      ].join("");

  const reimb = (opts.reimbursementLines ?? []).filter((l) => (l.cents ?? 0) > 0);
  const reimbRows = reimb.map((l) =>
    `<tr><td>${esc(l.label ?? "Reimbursement")}<small>at cost — approved expense</small></td><td class="r mono">${money(l.cents ?? 0)}</td></tr>`,
  ).join("");

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
  .from .name{font-size:20px;font-weight:700;letter-spacing:.02em}
  .from .entity{font-size:11px;color:#4A525B;margin-top:8px;line-height:1.6}
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
  td{padding:10px 0;border-bottom:1px solid #E3E6E9;font-size:13px;vertical-align:top}
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
    <div class="from">
      <div class="name">${esc(opts.contractor.company_name || "Contractor")}</div>
      <div class="entity">${esc(opts.contractor.address || "")}<br>ABN ${esc(opts.contractor.abn || "")}</div>
    </div>
    <div class="doctype">
      <h1>${esc(opts.heading)}</h1>
      <div class="num mono">${esc(opts.number)}</div>
      <div class="date">${esc(fmtDate(opts.invoiceDate ?? opts.submittedOn))}</div>
    </div>
  </div>

  <div class="grid">
    <div><div class="k">Bill to</div><div class="v">${esc(opts.billTo.tradingName || "Paint Group")}<small>${esc(opts.billTo.address || "")}${opts.billTo.abn ? ` · ABN ${esc(opts.billTo.abn)}` : ""}</small></div></div>
    <div><div class="k">Job</div><div class="v mono">${esc(opts.woRef)}<small>${esc(opts.jobTitle)}</small></div></div>
    <div><div class="k">Pay to</div><div class="v mono">BSB ${esc(opts.contractor.bank_bsb || "")}<small>Account ····${esc(opts.contractor.bank_last4 || "")}</small></div></div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
    <tbody>${lines}${reimbRows}</tbody>
  </table>

  <div class="totals">
    ${opts.gstCents > 0 ? `<div class="trow"><span>Subtotal (ex GST)</span><b>${money(opts.subtotalExCents)}</b></div>
    <div class="trow"><span>GST</span><b>${money(opts.gstCents)}</b></div>` : ""}
    <div class="trow big"><span>Total due</span><b>${money(opts.totalIncCents)}</b></div>
    ${opts.gstCents === 0 ? `<div class="trow"><span>No GST — supplier not registered</span><b>—</b></div>` : ""}
    ${opts.dueOn ? `<div class="trow"><span>Payment due</span><b>${esc(fmtDate(opts.dueOn))}</b></div>` : ""}
  </div>

  <div class="note">Please pay by bank transfer to the account above, referencing ${esc(opts.number)}.</div>

  <div class="foot">
    <span>${esc(opts.contractor.company_name || "")} · ABN ${esc(opts.contractor.abn || "")}</span>
    <span class="mono">${esc(opts.number)}</span>
  </div>
</div>
</body></html>`;
}
