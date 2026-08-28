/**
 * The payment receipt — a small, self-contained white A4 document rendered
 * straight to PDF (no route behind it). Same visual language as the invoice:
 * professional, printable, ATO-sensible (receipts state the GST component of
 * the amount received). Customer-facing copy is ENGLISH tone.
 */

import { fromIncTotal } from "./gst";
import { money } from "@/lib/format/money";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


const METHOD_LABEL: Record<string, string> = {
  stripe_card: "Card (online)",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  other: "Other",
};

export function buildReceiptHtml(opts: {
  receiptNumber: string;
  invoiceNumber: string;
  amountCents: number;
  surchargeCents: number;
  method: string;
  paidOn: string | null; // yyyy-mm-dd
  billedTo: string;
  jobAddress: string;
  entity: Record<string, string>;
}): string {
  const gst = fromIncTotal(opts.amountCents);
  const date = opts.paidOn
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(opts.paidOn + "T00:00:00Z"))
    : "";
  const name = esc(opts.entity.tradingName || "Paint Group");

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
      <div class="tagline">${esc(opts.entity.brandSub || "Painting · Plastering · Restoration")}</div>
      <div class="entity">${esc(opts.entity.address || "")}<br>ABN ${esc(opts.entity.abn || "")}</div>
    </div>
    <div class="doctype">
      <h1>RECEIPT</h1>
      <div class="num mono">${esc(opts.receiptNumber)}</div>
      <div class="date">${esc(date)}</div>
    </div>
  </div>

  <div class="grid">
    <div><div class="k">Received from</div><div class="v">${esc(opts.billedTo || "—")}<small>${esc(opts.jobAddress)}</small></div></div>
    <div><div class="k">Against invoice</div><div class="v mono">${esc(opts.invoiceNumber)}</div></div>
    <div><div class="k">Payment method</div><div class="v">${esc(METHOD_LABEL[opts.method] ?? opts.method)}</div></div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
    <tbody>
      <tr><td>Payment received — invoice ${esc(opts.invoiceNumber)}</td><td class="r mono">${money(opts.amountCents)}</td></tr>
      ${opts.surchargeCents > 0 ? `<tr><td>Card payment surcharge</td><td class="r mono">${money(opts.surchargeCents)}</td></tr>` : ""}
    </tbody>
  </table>

  <div class="totals">
    <div class="trow big"><span>Total received</span><b>${money(opts.amountCents + opts.surchargeCents)}</b></div>
    <div class="trow"><span>Includes GST of</span><b>${money(gst.gstCents + (opts.surchargeCents > 0 ? fromIncTotal(opts.surchargeCents).gstCents : 0))}</b></div>
  </div>

  <div class="note">Thank you for your payment. Please keep this receipt for your records — it confirms the amount above has been received against the invoice shown.</div>

  <div class="foot">
    <span>${name} · ABN ${esc(opts.entity.abn || "")}</span>
    <span class="mono">${esc(opts.receiptNumber)}</span>
  </div>
</div>
</body></html>`;
}
