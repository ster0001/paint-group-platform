/**
 * The completion report as a white A4 document — attached to the sign-off
 * email so the customer holds a copy that never depends on a link. Rendered
 * ENTIRELY from the report jsonb frozen at signing (same source as the /s
 * page): what was signed is what the PDF says, for ever.
 *
 * Rules carried over from the on-screen report:
 * - Declined variations ARE shown ("flagged, declined — not part of the
 *   work" is the record that settles a warranty argument).
 * - The QA tally is OURS and never customer-facing (Tom, 23 Aug).
 * - Photos stay online (signed URLs expire; the PDF points at the report
 *   page instead of embedding them).
 */

import type { Report } from "@/app/s/[token]/CompletionReport";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

export function buildCompletionReportHtml(opts: {
  report: Report;
  jobTitle: string;
  warrantyEnds: string | null;
  warrantyYears: number | null;
  companyName: string;
  companyPhone?: string;
  /** The LIGHT-background logo — this is a white document. */
  logoUrl?: string;
  /** The customer's own online report (photos live there). */
  reportUrl: string;
}): string {
  const r = opts.report;
  const byHeading = new Map<string, Report["surfaces"]>();
  for (const s of r.surfaces ?? []) {
    byHeading.set(s.heading, [...(byHeading.get(s.heading) ?? []), s]);
  }
  const variations = (r.variations ?? []).filter((v) => v.status !== "cancelled");
  const hasPhotos = (r.photos ?? []).some((p) => p.kind !== "qa");

  const areasHtml = [...byHeading.entries()].map(([heading, rows]) => `
    <div class="area">
      <div class="area-h">${esc(heading)}</div>
      <ul>${rows.map((s) => `<li>${esc(s.label)}${s.rectification ? `<em> · attended after your walkthrough</em>` : ""}</li>`).join("")}</ul>
    </div>`).join("");

  const variationsHtml = variations.length === 0 ? "" : `
    <h2>Changes along the way</h2>
    <ul class="vars">${variations.map((v) => {
      const label = esc(v.category.replace(/_/g, " "));
      const detail = v.status === "declined"
        ? `<em> · flagged by the painter, declined — not part of the work</em>`
        : v.price_cents != null ? ` · ${v.credit ? "−" : ""}${money(v.price_cents)}` : "";
      const signed = v.signed_name
        ? `<em> · signed by ${esc(v.signed_name)}${v.signed_at ? ` on ${dateFmt(v.signed_at)}` : ""}</em>`
        : "";
      return `<li><b class="cap">${label}</b>${v.comment ? ` — ${esc(v.comment)}` : ""}${detail}${signed}</li>`;
    }).join("")}</ul>`;

  const logo = opts.logoUrl
    ? `<img class="logo" src="${esc(opts.logoUrl)}" alt="${esc(opts.companyName)}">`
    : `<div class="wordmark">${esc(opts.companyName)}</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Switzer',system-ui,-apple-system,sans-serif;color:#111417;background:#fff;
    font-size:13px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:720px;margin:0 auto;padding:8px 4px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
    border-bottom:3px solid #111417;padding-bottom:18px}
  .logo{height:44px;max-width:230px;object-fit:contain}
  .wordmark{font-size:22px;font-weight:700;letter-spacing:.12em}
  .doc-title{text-align:right;font-size:18px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
  .doc-meta{margin-top:6px;text-align:right;font-size:11px;color:#555;line-height:1.6}
  h1{font-size:21px;font-weight:700;margin:22px 0 2px}
  .signedline{font-size:12px;color:#555;margin-bottom:16px}
  .warranty{border:1.5px solid #111417;border-radius:8px;padding:12px 14px;margin:0 0 20px;break-inside:avoid}
  .warranty b{display:block;margin-bottom:2px}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #ccc;
    padding-bottom:4px;margin:20px 0 10px}
  .area{margin-bottom:12px;break-inside:avoid}
  .area-h{font-weight:600;margin-bottom:3px}
  ul{padding-left:18px}
  li{margin-bottom:2px}
  em{color:#666;font-style:normal;font-size:12px}
  .cap{text-transform:capitalize}
  .vars li{margin-bottom:5px}
  .photos-note,.foot{font-size:11px;color:#555}
  .photos-note{margin-top:16px}
  .foot{margin-top:26px;padding-top:10px;border-top:1px solid #ccc}
  a{color:#111417}
</style></head>
<body><div class="sheet">
  <div class="top">
    ${logo}
    <div>
      <div class="doc-title">Completion report</div>
      <div class="doc-meta">${esc(r.wo_ref)}<br>Signed ${esc(dateFmt(r.signed_at))}</div>
    </div>
  </div>

  <h1>${esc(opts.jobTitle)}</h1>
  <p class="signedline">Signed off by ${esc(r.signed_name)} on ${esc(dateFmt(r.signed_at))}.</p>

  <div class="warranty">
    <b>${opts.warrantyYears ?? 2}-year workmanship warranty</b>
    ${esc(dateFmt(r.warranty_starts))}${opts.warrantyEnds ? ` — ${esc(dateFmt(opts.warrantyEnds))}` : ""}.
    Anything you notice later in that window, get in touch — it's covered.
  </div>

  <h2>What was done</h2>
  ${areasHtml}
  ${variationsHtml}

  ${hasPhotos ? `<p class="photos-note">Photos from your job live with your online report: <a href="${esc(opts.reportUrl)}">${esc(opts.reportUrl)}</a></p>` : ""}

  <div class="foot">
    ${esc(opts.companyName)}${opts.companyPhone ? ` · ${esc(opts.companyPhone)}` : ""} ·
    This report was frozen at sign-off and does not change.
  </div>
</div></body></html>`;
}
