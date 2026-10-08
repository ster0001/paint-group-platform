import type { Standards } from "./model";
import { LEVELS } from "./model";

/**
 * The PDF copy of the standards a painter keeps after confirming (ruling S8,
 * message 3): every word from the same `Standards` the screens read — the
 * three levels, the rules, time and variations, every surface at all three
 * levels, the defect rule, the final checklist and the words. Rendered to PDF
 * by lib/invoicing/pdf.ts renderHtmlToPdf. Print-plain on purpose: black on
 * white, no theme, readable on a phone with no signal.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function standardsPdfHtml(standards: Standards, who: { painterName: string; confirmedOn: string; companyName: string }): string {
  const s = standards;
  const list = (items: string[], ordered = false) => `<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
  const rows = (items: { label: string; text: string }[]) => `<dl>${items.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join("")}</dl>`;
  const surface = (sf: Standards["surfaces"][number]) => `
    <section class="surface">
      <h3>${esc(sf.name)}</h3>
      ${sf.intro ? `<p>${esc(sf.intro)}</p>` : ""}
      <p class="every"><b>Every level:</b> ${esc(sf.everyLevel)}</p>
      <table><thead><tr><th></th>${LEVELS.map((l) => `<th>Level ${l}</th>`).join("")}</tr></thead>
      <tbody>${sf.checks.map((c) => `<tr><th>${esc(c.label)}</th>${LEVELS.map((l) => `<td>${esc(c.text[l])}</td>`).join("")}</tr>`).join("")}</tbody></table>
      ${sf.note ? `<p class="note">${esc(sf.note)}</p>` : ""}
    </section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.version.title)}</title>
<style>
  body{font:12px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#111;margin:28px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #999;padding-bottom:3px} h3{font-size:13px;margin:14px 0 4px}
  p{margin:0 0 6px} .meta{color:#555;font-size:11px;margin-bottom:14px}
  dl{margin:0 0 8px} dt{font-weight:700;margin-top:6px} dd{margin:0 0 2px}
  ul,ol{margin:0 0 8px;padding-left:20px} li{margin-bottom:3px}
  table{width:100%;border-collapse:collapse;margin:6px 0;font-size:11px} th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:top;text-align:left} thead th{background:#eee}
  tbody th{width:14%;background:#f7f7f7} .note{color:#444;font-style:italic} .every{margin:4px 0}
  .surface{page-break-inside:avoid} .confirm{border:1px solid #999;padding:8px 10px;margin:10px 0 16px;background:#f7f7f7}
</style></head><body>
<h1>${esc(s.version.title)}</h1>
<p class="meta">Version ${s.version.no} · approved ${esc(s.version.publishedOn)} · ${esc(who.companyName)}</p>
<div class="confirm"><b>${esc(who.painterName)}</b> read and confirmed these standards on ${esc(who.confirmedOn)}: the three levels and the look test, rules for every job, time and variations, interior surfaces, exterior surfaces, the defect rule and final checklist.</div>

<h2>The three levels</h2>
<p>${esc(s.levels.intro)}</p>
${s.levels.items.map((i) => `<h3>Level ${i.level} — ${esc(i.name)} (look test ${esc(i.look_test_distance)})</h3>${rows(i.summary)}`).join("")}
<h3>How to use the look test</h3>${list(s.levels.look_test_steps, true)}<p>${esc(s.levels.look_test_high_areas)}</p><p class="note">${esc(s.levels.closing)}</p>

<h2>Rules for every job</h2>
<p>${esc(s.rules.intro)}</p>${rows(s.rules.items.map((r) => ({ label: r.rule, text: r.meaning })))}<p class="note">${esc(s.rules.closing)}</p>

<h2>Your time, extra time and variations</h2>
<p>${esc(s.time.intro)}</p>
<h3>Standard preparation, interior</h3>${list(s.time.standard_preparation.interior)}
<h3>Standard preparation, exterior</h3>${list(s.time.standard_preparation.exterior)}
<h3>Extra time, shown on your work order</h3><p>${esc(s.time.extra_time_intro)}</p>
${rows(s.time.extra_time.map((x) => ({ label: x.name, text: `${x.meaning} Examples: ${x.examples}` })))}
<h3>Variations</h3><p>${esc(s.time.variation_intro)}</p>${list(s.time.variation_steps, true)}<p class="note">${esc(s.time.closing)}</p>

<h2>Interior surfaces</h2>
<p>${esc(s.interior.intro)}</p>
${s.surfaces.filter((x) => x.side === "interior").map(surface).join("")}

<h2>Exterior surfaces</h2>
<p>${esc(s.exterior.intro)}</p>${list(s.exterior.rules)}
${s.surfaces.filter((x) => x.side === "exterior").map(surface).join("")}

<h2>The defect rule</h2>
<p>${esc(s.defect.intro)}</p>${list(s.defect.steps, true)}<p class="note">${esc(s.defect.small_job_note)}</p>
<h3>Why we do this</h3>${list(s.defect.why)}
<h3>What counts as a defect</h3>${rows(s.defect.defects.map((d) => ({ label: d.defect, text: d.examples })))}<p class="note">${esc(s.defect.closing)}</p>

<h2>Final checklist</h2>
<p>${esc(s.checklist.intro)}</p>${list(s.checklist.items, true)}

<h2>Words we use</h2>
${rows(s.words.items.map((w) => ({ label: w.word, text: w.meaning })))}
</body></html>`;
}
