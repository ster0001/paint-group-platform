// READ ONLY (24 Oct 2026, work-order UX Step 0): which surface lines on live work
// orders fall into which customer wording group (brief §4.3), and which fall in none.
//   node --experimental-strip-types scripts/diag/wo-surface-groups.mjs
// Reads .env.local like the other diag scripts: production, read only. The static
// mapping (lib/standards/codes.ts → group) is complete without it; this only adds
// the counts on real jobs.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SURFACE_CODES } from "../../lib/standards/codes.ts";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
console.log("project", env.NEXT_PUBLIC_SUPABASE_URL);

// Brief §4.3: group ← standards surface (one mapping, read off codes.ts).
const GROUP_OF_SURFACE = {
  ceilings: "ceilings", cornices: "ceilings", walls: "walls",
  skirting: "trims", architraves: "trims", doors: "trims", windowframes: "windows",
  weatherboards: "ext_body", brick: "ext_body", render: "ext_body",
  fascias: "ext_trim", eaves: "ext_trim", strapping: "ext_trim", fretwork: "ext_trim",
  extdoors: "ext_openings", extwindows: "ext_openings", picket: "ext_fence",
};
const codeGroup = new Map(); // `${side}|${code}` → group
for (const [surf, { side, codes }] of Object.entries(SURFACE_CODES)) for (const c of codes) codeGroup.set(`${side}|${c}`, GROUP_OF_SURFACE[surf]);

const { data: jobs, error } = await db.from("work_orders").select("id, wo_ref, stage, wo_snapshot").not("issued_at", "is", null).neq("stage", "closed").limit(1000);
if (error) { console.log("work_orders read failed:", error.message); process.exit(1); }

const tally = new Map(); let lines = 0;
for (const j of jobs) for (const a of j.wo_snapshot?.areas ?? []) {
  const side = a.side ?? null;
  for (const s of a.surfaces ?? []) {
    lines += 1;
    const code = s.code ?? null;
    const key = `${code ?? "(no code)"} :: ${s.label ?? ""}`;
    const g = code ? (codeGroup.get(`${side}|${code}`) ?? codeGroup.get(`interior|${code}`) ?? codeGroup.get(`exterior|${code}`) ?? null) : null;
    const e = tally.get(key) ?? { n: 0, jobs: new Set(), group: g, sides: new Set() };
    e.n += 1; e.jobs.add(j.wo_ref); e.sides.add(side ?? "?"); tally.set(key, e);
  }
}
console.log(`${jobs.length} job(s) · ${lines} surface lines\n`);
const rows = [...tally.entries()].sort((a, b) => b[1].n - a[1].n);
console.log("Mapped to a customer group:");
for (const [k, e] of rows) if (e.group) console.log(`  ${String(e.n).padStart(4)} ${e.group.padEnd(13)} ${k}  [${[...e.sides].join(",")}]`);
console.log("\nNo group (ticks, never a customer message):");
for (const [k, e] of rows) if (!e.group) console.log(`  ${String(e.n).padStart(4)} ${k}  [${[...e.sides].join(",")}] on ${e.jobs.size} job(s)`);

const { count: total } = await db.from("wo_surfaces").select("id", { count: "exact", head: true });
const { count: keyed } = await db.from("wo_surfaces").select("id", { count: "exact", head: true }).not("surface_key", "is", null);
console.log(`\nwo_surfaces rows ${total}, with a surface_key (joinable to a code) ${keyed}`);
