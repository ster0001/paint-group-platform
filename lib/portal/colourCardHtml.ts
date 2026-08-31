/**
 * Session 6 · The colour card PDF (⚑7, 31 Aug): Paint Group branded, the
 * property references in the header, one row per colour record — brand,
 * colour name, manufacturer code, product, sheen, coats, applied dates —
 * with a "where to buy" line from Settings so the client can buy touch-up
 * paint themselves. NEVER Paint Group's trade account number or trade
 * pricing (the shape carries no money at all). Footer: the warranty line +
 * a touch-up deep link back to the property.
 */
import type { PropertyColourCard } from "./tradeData";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildColourCardHtml(opts: {
  address: string;
  referencesLine: string | null;
  cards: PropertyColourCard[];
  whereToBuy: string;
  companyName: string;
  companyPhone?: string;
  logoUrl?: string;
  touchUpUrl: string;
  dateLabel: string;
}): string {
  const current = opts.cards.filter((c) => c.status !== "superseded");
  const previous = opts.cards.filter((c) => c.status === "superseded");
  const anyLossy = opts.cards.some((c) => c.lossy);

  const row = (c: PropertyColourCard) => `
    <tr>
      <td><span class="sw" style="background:${c.swatchHex ? esc(c.swatchHex) : "#eceef0"}"></span></td>
      <td><b>${esc(c.areaLabel)}</b><br><span class="mut">${esc(c.surfaceType)}</span></td>
      <td>${esc([c.brand, c.colourName].filter(Boolean).join(" "))}${c.colourCode ? `<br><span class="mut">${esc(c.colourCode)}</span>` : ""}</td>
      <td>${esc(c.product)}${c.sheen ? `<br><span class="mut">${esc(c.sheen)}</span>` : ""}</td>
      <td>${c.coats || ""}</td>
      <td>${c.appliedFrom ? esc(c.appliedFrom) + (c.appliedTo && c.appliedTo !== c.appliedFrom ? `–${esc(c.appliedTo)}` : "") : c.status === "planned" ? "scheduled" : ""}</td>
    </tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #16181b; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .head img { max-height: 42px; }
    h1 { font-size: 19px; margin: 0 0 2px; }
    h2 { font-size: 13px; margin: 18px 0 6px; }
    .mut { color: #5a6067; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 7px 8px; border-bottom: 1px solid #e3e6e9; text-align: left; vertical-align: top; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5a6067; }
    .sw { display: inline-block; width: 26px; height: 26px; border-radius: 6px; border: 1px solid #d5d9dd; }
    tr.prev td { color: #7a8087; }
    .buy { margin-top: 14px; padding: 10px 12px; background: #f4f6f8; border-radius: 8px; }
    .foot { margin-top: 18px; color: #5a6067; font-size: 11px; line-height: 1.6; }
  </style></head><body>
    <div class="head">
      <div>
        <h1>Colour card — ${esc(opts.address)}</h1>
        <div class="mut">${opts.referencesLine ? esc(opts.referencesLine) + " · " : ""}${esc(opts.dateLabel)}</div>
      </div>
      ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="${esc(opts.companyName)}">` : `<b>${esc(opts.companyName)}</b>`}
    </div>
    <table>
      <thead><tr><th></th><th>Where</th><th>Colour</th><th>Product</th><th>Coats</th><th>Applied</th></tr></thead>
      <tbody>${current.map(row).join("") || `<tr><td colspan="6">No colours on record yet.</td></tr>`}</tbody>
    </table>
    ${previous.length ? `<h2>Previous colours</h2><table><tbody>${previous.map((c) => `<tr class="prev">${row(c).replace('<tr>', "").replace("</tr>", "")}</tr>`).join("")}</tbody></table>` : ""}
    ${anyLossy ? `<p class="mut" style="margin-top:8px">Some rows come from the original estimate and may not show every room.</p>` : ""}
    ${opts.whereToBuy ? `<div class="buy"><b>Buying touch-up paint yourself?</b><br>${esc(opts.whereToBuy)}</div>` : ""}
    <div class="foot">
      ${esc(opts.companyName)}'s workmanship warranty covers work carried out by ${esc(opts.companyName)} only.<br>
      Rather we did it? Request a touch-up any time: ${esc(opts.touchUpUrl)}${opts.companyPhone ? ` · ${esc(opts.companyPhone)}` : ""}
    </div>
  </body></html>`;
}
