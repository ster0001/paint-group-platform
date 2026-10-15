import type { Induction, InductionKind } from "./read";
import { linesFor, modulesFor } from "./read";
import { htmlLang, languageOf } from "./languages";

/**
 * The PDF copy of the induction a painter keeps after the last tick (brief §5):
 * every line they read and ticked, in the language they ticked it in, module
 * by module, with the tick statement under each — the same rows the screens
 * read, so the PDF text equals the content ticked (Step 5 acceptance). Module
 * 5 lists the six standards sections; the standards themselves are the
 * separate standards PDF. Print-plain: black on white, right-to-left where the
 * language is.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function inductionPdfHtml(induction: Induction, kind: InductionKind, who: { painterName: string; completedOn: string; companyName: string; checkLine: string | null }): string {
  const lang = induction.language;
  const dir = induction.dir;
  const title = kind === "worker" ? "Worker induction" : kind === "refresher" ? "Induction refresher" : "Contractor induction";
  const modules = modulesFor(induction, kind);
  return `<!doctype html><html lang="${htmlLang(lang)}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(who.companyName)} — ${esc(title)}</title>
<style>
  body{font:12px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,"Noto Sans Arabic","Noto Naskh Arabic",sans-serif;color:#111;margin:28px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
  p{margin:0 0 6px} .meta{color:#555;font-size:11px;margin-bottom:14px}
  ol{margin:0 0 8px;padding-inline-start:22px} li{margin-bottom:4px}
  .tick{border:1px solid #999;padding:6px 10px;margin:6px 0 12px;background:#f7f7f7;font-weight:700}
  .confirm{border:1px solid #999;padding:8px 10px;margin:10px 0 16px;background:#f7f7f7}
  .module{page-break-inside:avoid} .en{color:#555;font-size:11px}
</style></head><body>
<h1>${esc(who.companyName)} — ${esc(title)}</h1>
<p class="meta">Version ${induction.version.no} · ${esc(languageOf(lang).name)}</p>
<div class="confirm"><b>${esc(who.painterName)}</b> read and ticked every module below on ${esc(who.completedOn)}.${who.checkLine ? ` ${esc(who.checkLine)}` : ""}</div>
${modules.map((m) => `
<section class="module">
  <h2>${m.no === 0 ? "" : `${m.no}. `}${esc(m.title)}</h2>
  ${m.standardsSections.length
    ? `<p>${esc(m.statements.map((s) => s.text).join(" · "))}</p><p class="en">The six finish standards sections were read and ticked in the Standards tab; the signed copy is the separate finish standards PDF.</p>`
    : `<ol>${linesFor(m, kind).map((l) => `<li>${esc(l.text)}</li>`).join("")}</ol>`}
  <div class="tick">✓ ${esc(m.tick.text)}</div>
</section>`).join("")}
</body></html>`;
}
