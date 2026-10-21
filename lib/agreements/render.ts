import { SCHEDULE_KEYS, SIGNATURE_FIELDS, splitTokens, unresolvedFields, type AgreementFile, type Block, type MergeField, type MergeValues } from "./source";

/**
 * ONE renderer for the agreement (brief §6): the portal page and the PDF are
 * the same HTML from the same blocks and the same values, so what the
 * contractor reads is what gets locked. Pure: strings in, a string out.
 *
 * Two modes. `page` returns the document fragment the portal wraps (the
 * schedule summary, the body, the signing blocks); `pdf` wraps the same
 * fragment in a print document with the audit footer. A field that is
 * neither resolved nor listed as `pending` throws — a blank where an ABN
 * should be is worse than an error. `pending` is for the preview before
 * signing: the signing-time fields render as marked slots, never as blanks.
 */

export type RenderAudit = { version: number; signedAtMelbourne: string; ip: string; userAgent: string; bodySha256: string; countersignLine: string };

export type RenderOptions = {
  mode: "page" | "pdf";
  /** Fields allowed to be unresolved, shown as slots (the preview before signing). */
  pending?: readonly MergeField[];
  /** PDF only: the footer on the signing page. */
  audit?: RenderAudit;
};

/** The fields set at the moment of signing, unresolved on the preview. */
export const SIGNING_FIELDS: readonly MergeField[] = ["contractor.signed_name", "contractor.signed_on", "contractor.signature", "company.signed_on", "company.signature", "agreement.signed_on"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A date value is printed as the day, Melbourne; anything else as given. */
export function displayValue(field: MergeField, value: string): string {
  if (/_on$/.test(field) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
  }
  return value;
}

const PENDING_WORD: Record<string, string> = {
  "contractor.signed_name": "your name, on signing",
  "contractor.signed_on": "date of signing",
  "contractor.signature": "your signature",
  "company.signed_on": "date of signing",
  "company.signature": "signed on your signing",
  "agreement.signed_on": "date of signing",
};

function renderText(text: string, values: MergeValues, pending: ReadonlySet<MergeField>): string {
  return splitTokens(text).map((r) => {
    if (r.kind === "text") return esc(r.text);
    const v = (values[r.field] ?? "").trim();
    if (!v) {
      if (!pending.has(r.field)) throw new Error(`agreement render: {{${r.field}}} is unresolved`);
      return `<span class="ag-pending" data-field="${r.field}">${esc(PENDING_WORD[r.field] ?? r.field)}</span>`;
    }
    if (SIGNATURE_FIELDS.includes(r.field)) return `<img class="ag-sig" alt="Signature" src="${esc(v)}">`;
    return `<span class="ag-merge" data-field="${r.field}">${esc(displayValue(r.field, v))}</span>`;
  }).join("");
}

function renderBlock(b: Block, values: MergeValues, pending: ReadonlySet<MergeField>): string {
  switch (b.kind) {
    case "heading": {
      const tag = b.level === 2 ? "h2" : b.level === 3 ? "h3" : "h4";
      return `<${tag}>${renderText(b.text, values, pending)}</${tag}>`;
    }
    case "para": return `<p>${renderText(b.text, values, pending)}</p>`;
    case "item": return `<p class="ag-li ag-l${b.level}"><span class="ag-m">${esc(b.marker)}</span>${renderText(b.text, values, pending)}</p>`;
    case "table": {
      const [head, ...rows] = b.rows;
      const cell = (c: string, tag: "th" | "td") => `<${tag}>${renderText(c, values, pending)}</${tag}>`;
      return `<table class="ag-table"><thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("")}</tbody></table>`;
    }
  }
}

/** The boxes above the legal body (brief §3 step 3): the schedule items a contractor needs to see first. */
const SUMMARY: { key: string; label: string }[] = [
  { key: "A", label: "Date of agreement" },
  { key: "B", label: "Contractor" },
  { key: "D", label: "Commencement date" },
  { key: "M", label: "Expiry" },
  { key: "E", label: "Contract fee" },
  { key: "F", label: "Services" },
  { key: "K", label: "Public liability minimum" },
];

export function renderSummary(file: AgreementFile, values: MergeValues, pending: ReadonlySet<MergeField>): string {
  const by = new Map(file.schedules.map((s) => [s.key, s]));
  return `<dl class="ag-summary">${SUMMARY.map(({ key, label }) => {
    const s = by.get(key);
    if (!s) throw new Error(`agreement render: Schedule ${key} is missing`);
    return `<div class="ag-sum"><dt>${esc(label)}</dt><dd>${renderText(s.value, values, pending)}</dd></div>`;
  }).join("")}</dl>`;
}

/** The document fragment: summary, title, body. Throws on an unresolved, non-pending field. */
export function renderAgreementFragment(file: AgreementFile, values: MergeValues, pendingFields: readonly MergeField[] = []): string {
  const pending = new Set(pendingFields);
  const unresolved = unresolvedFields(file, values).filter((f) => !pending.has(f));
  if (unresolved.length) throw new Error(`agreement render: unresolved ${unresolved.join(", ")}`);
  if (file.schedules.length !== SCHEDULE_KEYS.length) throw new Error("agreement render: schedules incomplete");
  return [
    `<header class="ag-head"><h1>${esc(file.title)}</h1><p class="ag-version">Version ${file.version} · effective ${displayValue("agreement.signed_on", file.approvedOn)}</p></header>`,
    renderSummary(file, values, pending),
    `<div class="ag-body">${file.blocks.map((b) => renderBlock(b, values, pending)).join("\n")}</div>`,
  ].join("\n");
}

export const AGREEMENT_CSS = `
.ag{font:12.5px/1.55 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#111}
.ag h1{font-size:20px;margin:0 0 2px}.ag .ag-version{color:#555;font-size:11px;margin:0 0 14px}
.ag h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #999;padding-bottom:3px;page-break-after:avoid}
.ag h3{font-size:13.5px;margin:16px 0 6px;page-break-after:avoid}.ag h4{font-size:12.5px;margin:12px 0 4px;page-break-after:avoid}
.ag p{margin:0 0 7px}.ag .ag-li{display:flex;gap:8px}.ag .ag-m{flex:0 0 2.2em;text-align:right}
.ag .ag-l1{padding-left:1.2em}.ag .ag-l2{padding-left:3.2em}.ag .ag-l3{padding-left:5.2em}
.ag .ag-table{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:12px;page-break-inside:avoid}
.ag .ag-table th,.ag .ag-table td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}
.ag .ag-table th{background:#f2f2f2;font-weight:600}
.ag .ag-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:0 0 18px;padding:0}
.ag .ag-sum{border:1px solid #999;border-radius:6px;padding:8px 10px;background:#f7f7f7}
.ag .ag-sum dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:0 0 2px}.ag .ag-sum dd{margin:0;font-weight:600}
.ag .ag-merge{font-weight:600}.ag .ag-pending{display:inline-block;min-width:9em;border-bottom:1px dashed #777;color:#777;font-style:italic;padding:0 4px}
.ag .ag-sig{display:block;max-height:64px;max-width:220px}
.ag .ag-audit{margin-top:24px;border-top:1px solid #999;padding-top:8px;font-size:10px;color:#444;word-break:break-all}
`;

/** The whole print document for the PDF: the fragment, the styles, the audit footer. No pending fields allowed. */
export function renderAgreementPdfHtml(file: AgreementFile, values: MergeValues, audit: RenderAudit): string {
  const fragment = renderAgreementFragment(file, values, []);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(file.title)} — Version ${file.version}</title>
<style>body{margin:28px}${AGREEMENT_CSS}</style></head><body><div class="ag">
${fragment}
<footer class="ag-audit">Signed electronically in the Paint Group contractor portal · Version ${audit.version} · ${esc(audit.signedAtMelbourne)} (Melbourne) · IP ${esc(audit.ip || "not recorded")} · ${esc(audit.userAgent || "device not recorded")}<br>${esc(audit.countersignLine)}<br>Document hash (SHA-256 of the wording as read): ${esc(audit.bodySha256)}</footer>
</div></body></html>`;
}

/** The visible text of a render, whitespace-folded — what the page-equals-PDF test compares. */
export function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}
