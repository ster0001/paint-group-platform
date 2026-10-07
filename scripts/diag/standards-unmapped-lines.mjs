// READ ONLY (8 Oct 2026, standards Step 1): which work-order lines have no
// finish standard behind them?
//   node scripts/diag/standards-unmapped-lines.mjs [--all]
// Walks every issued, not-yet-closed work order's job sheet (wo_snapshot) —
// `--all` includes closed jobs — resolves each surface line the way the app
// does (lib/standards/model.ts: the line's code, then its label as a rate
// code, then as a surface name; the area's side or its sibling lines decide
// interior vs exterior) and prints the lines that match nothing, grouped by
// label with a count. Those lines show no "What we expect" link. Also prints
// the rate-card codes with no surface, for the Step 1 report.
// Reads .env.local like the other diag scripts: production, read only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { standardsFromFile } from "../../lib/standards/source.ts";
import { SURFACE_CODES, UNMAPPED_RATE_CODES } from "../../lib/standards/codes.ts";
import { resolveSurface, levelOf } from "../../lib/standards/model.ts";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const all = process.argv.includes("--all");
console.log(`project ${env.NEXT_PUBLIC_SUPABASE_URL} · ${all ? "every issued job" : "issued jobs not yet closed"}`);

// The file, not the tables: this is about the mapping, and runs before the
// migration is pasted too.
const file = JSON.parse(readFileSync("docs/standards/finish-standards-v1.json", "utf8"));
const standards = standardsFromFile(file, SURFACE_CODES);

let q = db.from("work_orders").select("id, wo_ref, stage, wo_snapshot").not("issued_at", "is", null).order("issued_at", { ascending: false }).limit(1000);
if (!all) q = q.neq("stage", "closed");
const { data: jobs, error } = await q;
if (error) { console.log("work_orders read failed:", error.message); process.exit(1); }

const unmapped = new Map(); // label → { count, jobs:Set, codes:Set }
let lines = 0, mapped = 0, noLevel = 0;
for (const j of jobs) {
  for (const area of j.wo_snapshot?.areas ?? []) {
    const level = levelOf(area.finishCode);
    for (const s of area.surfaces ?? []) {
      lines += 1;
      if (!level) { noLevel += 1; continue; }
      const hit = resolveSurface(standards, s, { side: area.side ?? null, lines: area.surfaces });
      if (hit) { mapped += 1; continue; }
      const key = (s.label ?? "").trim() || "(blank)";
      const e = unmapped.get(key) ?? { count: 0, jobs: new Set(), codes: new Set() };
      e.count += 1; e.jobs.add(j.wo_ref); if (s.code) e.codes.add(s.code);
      unmapped.set(key, e);
    }
  }
}
console.log(`\n${jobs.length} job(s) · ${lines} surface lines · ${mapped} with a standard · ${noLevel} in an area with no PG level (Level 1 or unset) · ${lines - mapped - noLevel} with none\n`);
console.log("Lines with NO finish standard (no link shown), by label:");
for (const [label, e] of [...unmapped.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(e.count).padStart(4)} × ${label}${e.codes.size ? `  [code: ${[...e.codes].join(", ")}]` : ""}  — ${[...e.jobs].slice(0, 6).join(", ")}${e.jobs.size > 6 ? ` +${e.jobs.size - 6}` : ""}`);
}
console.log(`\nRate-card codes with no surface (lib/standards/codes.ts): ${UNMAPPED_RATE_CODES.join("; ")}`);
