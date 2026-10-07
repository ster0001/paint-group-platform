// READ ONLY (7 Oct 2026): why did this customer see the details screen again, and
// "Request a time" instead of the calendar? Usage, from the main checkout:
//   node scripts/diag/visit-path.mjs "Glen Waverley" tom@example.com
// Prints the booking rules, the suburb's zone rows, the zone's estimator with their
// Google connection and week, the account the email resolves to, the customer's
// latest estimate and wizard session — and a verdict for each screen.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [suburb, email] = process.argv.slice(2).map((s) => (s ?? "").trim());
if (!suburb) { console.error("usage: node scripts/diag/visit-path.mjs <suburb> [customer email]"); process.exit(1); }
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const EVENTS = "https://www.googleapis.com/auth/calendar.events";

const rules = must(await db.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle(), "rules")?.value ?? {};
console.log(`\nbooking rules: gateOrder=${rules.gateOrder ?? "details_first (default)"} calendarRequired=${rules.calendarRequired ?? "true (default)"} windowDays=${rules.windowDays ?? "21 (default)"} holidays=${(rules.publicHolidays ?? []).length}`);

const rows = must(await db.from("visit_suburbs").select("suburb, postcode, status, far_edge").ilike("suburb", suburb).order("postcode"), "visit_suburbs") ?? [];
console.log(`\nsuburb ${JSON.stringify(suburb)}: ${rows.length ? rows.map((r) => `${r.suburb} ${r.postcode} → ${r.status}${r.far_edge ? " (far edge)" : ""}`).join("; ") : "NOT IN THE LIST (unmapped → request screen)"}`);
const zones = [...new Set(rows.map((r) => r.status).filter((s) => s.startsWith("zone_")))];
for (const zone of zones) {
  const z = must(await db.from("visit_zones").select("key, label, estimator_id").eq("key", zone).maybeSingle(), "visit_zones");
  if (!z?.estimator_id) { console.log(`\n${zone}: NO ESTIMATOR assigned (Settings → Visit zones) → request screen`); continue; }
  const prof = must(await db.from("profiles").select("name").eq("id", z.estimator_id).maybeSingle(), "profiles");
  const conn = must(await db.from("staff_gcal_connections").select("google_email, scopes, sync_error, connected_at, updated_at").eq("staff_id", z.estimator_id).maybeSingle(), "staff_gcal_connections");
  const slotsRead = await db.from("visit_slots").select("id", { count: "exact", head: true }).eq("estimator_id", z.estimator_id);
  if (slotsRead.error) throw new Error(`visit_slots: ${slotsRead.error.message}`);
  const slots = { count: slotsRead.count ?? 0 };
  const canWrite = !!conn && typeof conn.scopes === "string" && conn.scopes.split(/\s+/).includes(EVENTS);
  console.log(`\n${zone}: estimator ${prof?.name ?? "?"} (${z.estimator_id})`);
  console.log(`  Google: ${conn ? `${conn.google_email ?? "?"}, connected ${String(conn.connected_at).slice(0, 16)}, updated ${String(conn.updated_at).slice(0, 16)}` : "NOT CONNECTED"}`);
  console.log(`  scopes: ${conn?.scopes ?? "(none)"}`);
  console.log(`  can write visits to the main calendar: ${canWrite ? "yes" : "NO"}${conn?.sync_error ? ` · sync_error: ${conn.sync_error}` : ""}`);
  console.log(`  week: ${slots.count ?? 0} slots`);
  const calendarRequired = rules.calendarRequired ?? true;
  if (calendarRequired && !canWrite) console.log(`  VERDICT: calendar required and ${conn ? "the connection has no calendar.events scope — Diary → Google Calendar → Reconnect (after the consent screen change)" : "no connection — Diary → Google Calendar → Connect"} → "Request a time"`);
  else if ((slots.count ?? 0) === 0) console.log(`  VERDICT: no week → no times → "Request a time". Settings → Visit schedule → Load the standard week`);
  else console.log(`  VERDICT: this zone can offer times (unless Google could not be reached at that moment, which also sends the customer to Request a time)`);
}

if (email) {
  const acc = must(await db.from("accounts").select("id, name, email, phone, created_at").ilike("email", email).order("created_at", { ascending: false }).limit(3), "accounts") ?? [];
  console.log(`\naccounts for ${email}: ${acc.length ? acc.map((a) => `${a.id} name=${JSON.stringify(a.name)} phone=${JSON.stringify(a.phone)} created ${String(a.created_at).slice(0, 16)}`).join("\n  ") : "NONE"}`);
  const complete = acc.some((a) => a.name && a.email && a.phone);
  const ids = acc.map((a) => a.id);
  const ests = ids.length ? must(await db.from("estimates").select("id, number, status, account_id, created_at").in("account_id", ids).order("created_at", { ascending: false }).limit(5), "estimates") ?? [] : [];
  console.log(`estimates linked to those accounts: ${ests.length ? ests.map((e) => `#${e.number ?? "?"} ${e.id} ${e.status} ${String(e.created_at).slice(0, 16)}`).join("; ") : "NONE"}`);
  const drafts = must(await db.from("wizard_drafts").select("started_at, suburb, estimate_id, gate_version, gate_shown_at, gate_completed_at, range_shown_at, range_option").ilike("email", email).order("started_at", { ascending: false }).limit(3), "wizard_drafts") ?? [];
  console.log(`wizard sessions for ${email}: ${drafts.length ? drafts.map((d) => `${String(d.started_at).slice(0, 16)} ${d.suburb ?? ""} estimate=${d.estimate_id ?? "none"} version=${d.gate_version} gate_completed=${d.gate_completed_at ? "yes" : "no"} range_shown=${d.range_shown_at ? "yes" : "no"} option=${d.range_option ?? "-"}`).join("\n  ") : "NONE"}`);
  const latestEst = ests[0];
  if (!acc.length) console.log(`VERDICT (details screen): no account for this email — the gate's save did not create one, so the visit page had nobody to read the details from`);
  else if (!complete) console.log(`VERDICT (details screen): the account is missing ${acc[0].name ? "" : "name "}${acc[0].phone ? "" : "phone "}— the visit page asks again until all three are there (an existing account only gets its BLANKS filled, never overwritten)`);
  else if (!latestEst) console.log(`VERDICT (details screen): the estimate is not linked to the account (account_id null) — the visit page reads contact through the estimate's account`);
  else console.log(`VERDICT (details screen): account complete and linked — the details screen should NOT have shown; tell Claude the estimate id above`);
}
