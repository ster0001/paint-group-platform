// READ ONLY (8 Oct): a job's walkthroughs, its flags and the walkthrough events.
//   node scripts/diag/wo-walkthroughs.mjs "Cavell"
// "Cancelled a walkthrough and can't rebook" needs the rows, not a guess.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
if (!needle) { console.error("give part of the job address"); process.exit(1); }
const { data: ests, error } = await db.from("estimates").select("id, number, title").ilike("title", `%${needle}%`).limit(10);
if (error) throw error;
for (const e of ests) {
  const { data: wos, error: wErr } = await db.from("work_orders").select("*").eq("estimate_id", e.id);
  if (wErr) { console.log("work_orders read failed:", wErr.message); continue; }
  for (const w of wos ?? []) {
    console.log(`\n#${e.number} ${e.title} | ${w.wo_ref} | stage=${w.stage}`);
    const keep = Object.fromEntries(Object.entries(w).filter(([k]) => /walk|unavail|sign|finish|stage|start|end/.test(k)));
    console.log("  wo:", JSON.stringify(keep));
    const { data: wts, error: tErr } = await db.from("wo_walkthroughs").select("*").eq("work_order_id", w.id).order("created_at");
    if (tErr) console.log("  walkthroughs read failed:", tErr.message);
    for (const t of wts ?? []) console.log("  wt:", JSON.stringify(t));
    const { data: offers, error: oErr } = await db.from("booking_offers").select("id, state, start_date, end_date, accepted_at").eq("work_order_id", w.id);
    if (oErr) console.log("  offers read failed:", oErr.message);
    for (const o of offers ?? []) console.log("  offer:", JSON.stringify(o));
    const { data: ev, error: eErr } = await db.from("wo_events").select("type, actor_kind, meta, created_at").eq("work_order_id", w.id).order("created_at", { ascending: false }).limit(40);
    if (eErr) console.log("  events read failed:", eErr.message);
    for (const x of ev ?? []) if (/walk|sign|stage|qa|finish|complete/.test(x.type)) console.log(`  ev: ${x.created_at.slice(0, 16)} ${x.type} ${x.actor_kind} ${JSON.stringify(x.meta)}`);
  }
}
