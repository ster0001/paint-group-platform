// READ ONLY (9 Oct): why has a job no customer update drafted? Usage:
//   node scripts/diag/wo-updates.mjs "Bridge Road"
// Prints the job's stage, the last 40 events by type, and its wo_updates rows.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
if (!needle) { console.error("give part of the job address"); process.exit(1); }
const { data: ests, error } = await db.from("estimates").select("id, number, title").ilike("title", `%${needle}%`).limit(10);
if (error) throw error;
for (const e of ests) {
  const { data: wos, error: wErr } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, stage_entered_at").eq("estimate_id", e.id);
  if (wErr) { console.log("work_orders read failed:", wErr.message); continue; }
  for (const w of wos ?? []) {
    console.log(`\n== ${e.number} ${e.title} — WO ${w.wo_ref} ${w.id} stage=${w.stage} since ${w.stage_entered_at}`);
    const { data: ev, error: evErr } = await db.from("wo_events").select("type, created_at, meta").eq("work_order_id", w.id).order("created_at", { ascending: false }).limit(40);
    if (evErr) console.log("events read failed:", evErr.message);
    for (const x of ev ?? []) console.log("  ev", x.created_at, x.type, JSON.stringify(x.meta ?? {}).slice(0, 140));
    const { data: up, error: upErr } = await db.from("wo_updates").select("*").eq("work_order_id", w.id).order("for_date", { ascending: false }).limit(10);
    if (upErr) console.log("updates read failed:", upErr.message);
    for (const u of up ?? []) console.log("  upd", u.for_date, u.status, (u.text ?? "").slice(0, 100));
    const { data: s, error: sErr } = await db.from("wo_surfaces").select("id, state, updated_at").eq("work_order_id", w.id).order("updated_at", { ascending: false }).limit(8);
    if (sErr) console.log("surfaces read failed:", sErr.message);
    for (const r of s ?? []) console.log("  surf", r.updated_at, r.state, r.id);
  }
}
