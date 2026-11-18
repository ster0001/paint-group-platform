/**
 * Go-live brief Session 6 — "calibration before customers": ten real past jobs re-entered through the wizard and
 * compared with what staff quoted. The pure half: matching the two estimates' areas by name and summarising the
 * differences. `scripts/wizard/calibration-compare.ts` reads the rows and prices them; nothing here touches money
 * beyond subtracting two engine results for a report.
 */
export type PricedArea = { name: string; type: "Interior" | "Exterior"; cents: number };
export type PricedEstimate = { id: string; label: string; source: string | null; createdAt: string; totalCents: number; areas: PricedArea[] };

/** "Bed 1" ~ "bedroom 1" ~ "Bedroom1"; "Kitchen / Living" ~ "kitchen living". */
export function normaliseAreaName(name: string): string {
  return name.toLowerCase()
    .replace(/\bbedroom\b/g, "bed").replace(/\bbathroom\b/g, "bath").replace(/\bens(uite)?\b/g, "ensuite")
    .replace(/\b(room|area)\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export type AreaMatch = { name: string; staffCents: number | null; wizardCents: number | null };

/** Pairs areas by normalised name; what only one side has is listed with the other side empty. */
export function matchAreas(staff: PricedArea[], wizard: PricedArea[]): AreaMatch[] {
  const out: AreaMatch[] = [];
  const used = new Set<number>();
  for (const s of staff) {
    const key = normaliseAreaName(s.name);
    const j = wizard.findIndex((w, k) => !used.has(k) && normaliseAreaName(w.name) === key);
    if (j >= 0) { used.add(j); out.push({ name: s.name, staffCents: s.cents, wizardCents: wizard[j].cents }); }
    else out.push({ name: s.name, staffCents: s.cents, wizardCents: null });
  }
  wizard.forEach((w, k) => { if (!used.has(k)) out.push({ name: w.name, staffCents: null, wizardCents: w.cents }); });
  return out;
}

export type PairSummary = { staffId: string; wizardId: string; staffCents: number; wizardCents: number; diffCents: number; diffPct: number };

export function summarisePair(staff: PricedEstimate, wizard: PricedEstimate): PairSummary {
  const diffCents = wizard.totalCents - staff.totalCents;
  return { staffId: staff.id, wizardId: wizard.id, staffCents: staff.totalCents, wizardCents: wizard.totalCents, diffCents, diffPct: staff.totalCents > 0 ? (diffCents / staff.totalCents) * 100 : 0 };
}

/** The median of the signed % differences, and how many pairs sit within ±10%. */
export function summariseAll(pairs: PairSummary[]): { medianPct: number; within10: number; count: number } {
  if (pairs.length === 0) return { medianPct: 0, within10: 0, count: 0 };
  const pcts = pairs.map((p) => p.diffPct).sort((a, b) => a - b);
  const mid = Math.floor(pcts.length / 2);
  const medianPct = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
  return { medianPct, within10: pairs.filter((p) => Math.abs(p.diffPct) <= 10).length, count: pairs.length };
}

const dollars = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100).toLocaleString("en-AU")}`);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** The Markdown report: one table per pair, then the roll-up. */
export function calibrationReport(rows: Array<{ staff: PricedEstimate; wizard: PricedEstimate }>, when: string): string {
  const lines: string[] = [`# Wizard calibration — ${rows.length} past jobs re-entered (${when})`, "",
    "Staff = the estimate the office sent; Wizard = the same job re-entered through the public wizard; both priced by today's engine over the live rate card.", ""];
  const pairs = rows.map((r) => summarisePair(r.staff, r.wizard));
  const all = summariseAll(pairs);
  lines.push("## Roll-up", "", `| Pairs | Median difference | Within ±10% |`, `|---|---|---|`, `| ${all.count} | ${pct(all.medianPct)} | ${all.within10} of ${all.count} |`, "");
  lines.push("| Job | Staff total | Wizard total | Difference |", "|---|---|---|---|");
  for (const [i, p] of pairs.entries()) lines.push(`| ${rows[i].staff.label} | ${dollars(p.staffCents)} | ${dollars(p.wizardCents)} | ${dollars(p.diffCents)} (${pct(p.diffPct)}) |`);
  lines.push("");
  for (const r of rows) {
    lines.push(`## ${r.staff.label}`, "", `Staff \`${r.staff.id}\` (${r.staff.source ?? "?"}, ${r.staff.createdAt.slice(0, 10)}) · Wizard \`${r.wizard.id}\` (${r.wizard.source ?? "?"}, ${r.wizard.createdAt.slice(0, 10)})`, "",
      "| Area | Staff | Wizard | Difference |", "|---|---|---|---|");
    for (const m of matchAreas(r.staff.areas, r.wizard.areas)) {
      const d = m.staffCents != null && m.wizardCents != null ? dollars(m.wizardCents - m.staffCents) : "—";
      lines.push(`| ${m.name} | ${dollars(m.staffCents)} | ${dollars(m.wizardCents)} | ${d} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
