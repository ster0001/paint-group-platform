// READ ONLY (7 Oct): did the painter hear about an approved variation? Usage:
//   node scripts/diag/variation-contractor-notify.mjs "Cavell"
// Prints the job, every wo_variations row (status, released/accepted times),
// the wo_events that mark a contractor notification, the automation holds and
// every outbound message on the job — so "did they get a text?" has data.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
if (!needle) { console.error("give part of the job address"); process.exit(1); }
console.log("target:", env.NEXT_PUBLIC_SUPABASE_URL);
const { data: ests, error } = await db.from("estimates").select("id, number, title").ilike("title", `%${needle}%`).limit(5);
if (error) throw error;
for (const e of ests) {
  const { data: wos, error: wErr } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, created_at").eq("estimate_id", e.id);
  if (wErr) { console.log("work_orders read failed:", wErr.message); continue; }
  for (const w of wos ?? []) {
    const { data: c } = w.contractor_id ? await db.from("contractors").select("id, company_name, phone, profile_id, profiles(name)").eq("id", w.contractor_id).maybeSingle() : { data: null };
    let email = null;
    if (c?.profile_id) { const { data: u } = await db.auth.admin.getUserById(c.profile_id); email = u?.user?.email ?? null; }
    console.log(`\n#${e.number} ${e.title} | ${w.wo_ref} | stage=${w.stage} | painter=${c?.company_name ?? "-"} / ${c?.profiles?.name ?? "-"} phone=${c?.phone ?? "-"} email=${email ?? "-"}`);
    const { data: vars, error: vErr } = await db.from("wo_variations").select("id, status, credit, revision_block_ref, customer_token, created_at, released_at, contractor_accepted_at, contractor_delta_cents").eq("work_order_id", w.id).order("created_at");
    if (vErr) console.log("wo_variations read failed:", vErr.message);
    for (const v of vars ?? []) console.log("  VAR", JSON.stringify(v));
    const { data: evs, error: eErr } = await db.from("wo_events").select("type, actor_kind, meta, created_at").eq("work_order_id", w.id).or("type.ilike.%variation%,type.ilike.%notif%").order("created_at");
    if (eErr) console.log("wo_events read failed:", eErr.message);
    for (const ev of evs ?? []) console.log("  EVT", ev.created_at, ev.type, ev.actor_kind, JSON.stringify(ev.meta));
    const { data: holds, error: hErr } = await db.from("automation_holds").select("id, automation_key, status, reason, reason_detail, to_phone, release_at, decided_at, result, created_at").eq("work_order_id", w.id).order("created_at");
    if (hErr) console.log("automation_holds read failed:", hErr.message);
    for (const h of holds ?? []) console.log("  HOLD", JSON.stringify(h));
    const { data: msgs, error: mErr } = await db.from("messages").select("channel, direction, status, provider, to_address, body, meta, occurred_at").eq("work_order_id", w.id).order("occurred_at");
    if (mErr) console.log("messages read failed:", mErr.message);
    for (const m of msgs ?? []) console.log("  MSG", m.occurred_at, m.channel, m.direction, m.status, m.provider, m.to_address, JSON.stringify(m.meta), "|", (m.body ?? "").slice(0, 160).replace(/\n/g, " "));
    if (c?.phone) {
      const { data: byPhone } = await db.from("messages").select("channel, direction, status, to_address, body, meta, occurred_at, work_order_id").eq("channel", "sms").eq("direction", "out").gte("occurred_at", new Date(Date.now() - 14 * 864e5).toISOString()).order("occurred_at").limit(500);
      const digits = (s) => (s ?? "").replace(/\D/g, "").slice(-9);
      for (const m of (byPhone ?? []).filter((m) => digits(m.to_address) === digits(c.phone) && m.work_order_id !== w.id)) console.log("  SMS-to-painter(other job)", m.occurred_at, m.status, JSON.stringify(m.meta), "|", (m.body ?? "").slice(0, 120));
    }
  }
}
const { data: ms } = await db.from("messaging_settings").select("*").limit(1).maybeSingle();
if (ms) { const a = ms.automations ?? ms.settings?.automations ?? null; console.log("\nautomations:", JSON.stringify(a ?? Object.keys(ms))); }
