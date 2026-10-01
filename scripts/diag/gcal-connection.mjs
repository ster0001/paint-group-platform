// READ ONLY (1 Oct): what does a painter's Google Calendar connection look like?
//   node scripts/diag/gcal-connection.mjs "DJ Decor"
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
const { data: cs, error } = await db.from("contractors").select("id, company_name, profile_id, profiles(name)").ilike("company_name", `%${needle}%`);
if (error) throw error;
for (const c of cs ?? []) {
  console.log("contractor", c.id, c.company_name, c.profiles);
  const { data: conn, error: e2 } = await db.from("contractor_gcal_connections").select("contractor_id, google_email, calendar_id, sync_error, connected_at, updated_at").eq("contractor_id", c.id);
  console.log(e2 ? `conn read failed: ${e2.message}` : conn);
  const { data: offers } = await db.from("booking_offers").select("id, state, start_date, payment_cents, hours_allowance, offered_at, work_orders(wo_ref, contractor_payment_cents)").eq("contractor_id", c.id).order("offered_at", { ascending: false }).limit(5);
  console.log("offers:", JSON.stringify(offers, null, 1));
}
const { data: all } = await db.from("contractor_gcal_connections").select("contractor_id, google_email, sync_error, connected_at").order("connected_at", { ascending: false }).limit(10);
console.log("recent connections:", all);
