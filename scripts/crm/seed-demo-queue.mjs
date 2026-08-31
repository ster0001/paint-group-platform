/**
 * CRM Phase 2A · demo data for the four-tab shell and the work queue.
 *
 * TARGET: PRODUCTION (.env.local), deliberately — Tom asked for dummy
 * customers to try the shell with before real estimates exist (31 Aug 2026).
 * Requires --yes-production so it can never run by reflex.
 *
 *   node scripts/crm/seed-demo-queue.mjs --yes-production          # create
 *   node scripts/crm/seed-demo-queue.mjs --yes-production --clean  # remove
 *
 * Every row is unmistakably a dummy: names end in "(demo)", emails are
 * plus-addressed to Tom's own inbox, and every created id is recorded in
 * scripts/crm/.crm-demo-manifest.json — --clean deletes exactly those ids
 * and nothing else. Events go through crm_log_event (the one write path).
 *
 * The cast covers each live queue source once, plus board-only customers to
 * make Customers/Diary worth looking at:
 *   snooze_expired (Grant) · reminder-with-promise (Ashwood) ·
 *   callback_requested (Renata) · invoice_action (Karen) ·
 *   approval_pending (2 queued campaign messages) · quoted+opened (Sarah) ·
 *   visit done, silent (Michael — NO item until 2A.4's rules exist, which is
 *   the point) · open wizard draft (Anh — the board's worth-a-call card).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const MANIFEST = resolve(HERE, ".crm-demo-manifest.json");

const EMAIL = (slug) => `tjhroman+crm.${slug}@gmail.com`;
const PHONE = "0422453136";

function env() {
  const out = {};
  for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const { NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = env();
if (!URL || !KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }
if (!process.argv.includes("--yes-production")) {
  console.error(`This script writes to ${URL} (PRODUCTION). Re-run with --yes-production.`);
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const die = (where, error) => { if (error) { console.error(`${where}: ${error.message}`); process.exit(1); } };

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const dateOnly = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function logEvent(type, accountId, payload, occurredAt, extra = {}) {
  const { error } = await sb.rpc("crm_log_event", {
    p_type: type, p_account_id: accountId, p_payload: payload,
    p_source: extra.source ?? "system", p_occurred_at: occurredAt,
    p_estimate_id: extra.estimateId ?? null,
    p_dedupe_key: extra.dedupeKey ?? null,
  });
  die(`event ${type}`, error);
}

// ---- clean ------------------------------------------------------------------

if (process.argv.includes("--clean")) {
  if (!existsSync(MANIFEST)) { console.log("No manifest — nothing to clean."); process.exit(0); }
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  // Children first; crm_events and dismissals cascade with the accounts.
  for (const [table, ids] of [
    ["payments", m.payments], ["invoices", m.invoices],
    ["campaign_messages", m.campaignMessages], ["campaign_enrolments", m.enrolments], ["campaigns", m.campaigns],
    ["wizard_drafts", m.drafts], ["estimates", m.estimates], ["properties", m.properties], ["accounts", m.accounts],
  ]) {
    if (!ids?.length) continue;
    const { error } = await sb.from(table).delete().in("id", ids);
    die(`clean ${table}`, error);
    console.log(`cleaned ${table}: ${ids.length}`);
  }
  unlinkSync(MANIFEST);
  console.log("Demo data removed.");
  process.exit(0);
}

// ---- seed -------------------------------------------------------------------

if (existsSync(MANIFEST)) {
  console.error("Manifest already exists — demo data is already in. Run with --clean first to reseed.");
  process.exit(1);
}

const m = { accounts: [], properties: [], estimates: [], invoices: [], payments: [], drafts: [], campaigns: [], enrolments: [], campaignMessages: [] };

async function account(slug, name, fields = {}) {
  const { data, error } = await sb.from("accounts")
    .insert({ email: EMAIL(slug), name: `${name} (demo)`, phone: PHONE, account_type: "residential", ...fields })
    .select("id").single();
  die(`account ${slug}`, error);
  m.accounts.push(data.id);
  return data.id;
}

async function property(accountId, address, suburb) {
  const { data, error } = await sb.from("properties")
    .insert({ account_id: accountId, address, suburb, postcode: "3000", address_norm: `${address} ${suburb} demo`.toLowerCase() })
    .select("id").single();
  die(`property ${suburb}`, error);
  m.properties.push(data.id);
  return data.id;
}

async function estimate(accountId, propertyId, fields) {
  const { data, error } = await sb.from("estimates")
    .insert({ account_id: accountId, property_id: propertyId, source: "manual", level_of_finish: 3, builder_state: {}, ...fields })
    .select("id").single();
  die(`estimate ${fields.title}`, error);
  m.estimates.push(data.id);
  return data.id;
}

// 1 · Sarah Mitchell — quoted 4 days ago, opened three times, silent. Board
//     shows the buying signal; Today stays quiet until the 2A.4 rules exist.
{
  const a = await account("sarah", "Sarah Mitchell", { temperature: "warm" });
  const p = await property(a, "18 Fairview Grove", "Camberwell");
  const e = await estimate(a, p, { title: "Victorian terrace — interior (demo)", status: "sent", total_cents: 842000, sent_at: daysAgo(4), viewed_at: daysAgo(3), created_at: daysAgo(4) });
  await logEvent("first_touch_recorded", a, { source: "google", detail: "search — painters camberwell" }, daysAgo(5));
  await logEvent("estimate_sent", a, { totalCents: 842000, channel: "email" }, daysAgo(4), { estimateId: e });
  for (let v = 1; v <= 3; v++) await logEvent("estimate_viewed", a, { viewNumber: v }, daysAgo(4 - v), { estimateId: e });
}

// 2 · Grant Fowler — the expired snooze. Today: overdue.
{
  const a = await account("grant", "Grant Fowler", { snoozed_until: daysAgo(1) });
  const p = await property(a, "7 Mavho Street", "Bentleigh");
  const e = await estimate(a, p, { title: "Exterior weatherboard (demo)", status: "sent", total_cents: 1630000, sent_at: daysAgo(20), viewed_at: daysAgo(18), created_at: daysAgo(20) });
  await logEvent("estimate_sent", a, { totalCents: 1630000, channel: "email" }, daysAgo(20), { estimateId: e });
  await logEvent("snoozed", a, { until: daysAgo(1), reason: "Deciding after their kitchen is done — call late Aug" }, daysAgo(22), { source: "staff" });
}

// 3 · Renata Alves — asked for a callback 26 hours ago. Today: overdue,
//     customer-visible, so it outranks everything internal.
{
  const a = await account("renata", "Renata Alves");
  await property(a, "2/14 Clarke Street", "Northcote");
  await logEvent("first_touch_recorded", a, { source: "website" }, hoursAgo(26));
  await logEvent("callback_requested", a, { phone: PHONE, note: "Northcote, two rooms. Asked for afternoon — phone-close, no visit needed." }, hoursAgo(26), { source: "customer" });
}

// 4 · Ashwood Court OC — a reminder WITH a note = a promise recorded, so it
//     ranks above bigger money. Today: overdue, top of the pile.
{
  const a = await account("ashwood", "Ashwood Court OC", {
    account_type: "trade",
    followup_due_at: daysAgo(1),
    followup_note: "Committee meets the 12th — promised the quote split by block by the 10th",
  });
  const p = await property(a, "1–14 Ashwood Court", "Glen Waverley");
  const e = await estimate(a, p, { title: "Body corporate, 14 units (demo)", status: "sent", total_cents: 4680000, sent_at: daysAgo(8), created_at: daysAgo(8) });
  await logEvent("estimate_sent", a, { totalCents: 4680000, channel: "email" }, daysAgo(8), { estimateId: e });
  await logEvent("followup_set", a, { dueAt: daysAgo(1), note: "Split the quote by block before the 10th" }, daysAgo(6), { source: "staff" });
}

// 5 · Karen Delaney — accepted, deposit invoiced and unpaid, due today.
//     Today: the money item.
{
  const a = await account("karen", "Karen Delaney", { temperature: "hot" });
  const p = await property(a, "31 Riversdale Road", "Hawthorn");
  const e = await estimate(a, p, { title: "Full interior, 4 bed (demo)", status: "accepted", total_cents: 924000, sent_at: daysAgo(10), viewed_at: daysAgo(9), accepted_at: daysAgo(6), created_at: daysAgo(10) });
  await logEvent("estimate_accepted", a, { totalCents: 924000, depositCents: 231000 }, daysAgo(6), { estimateId: e });
  const inv = await sb.from("invoices").insert({
    estimate_id: e, kind: "deposit", status: "issued", number: "DEMO-1001",
    token: `demo${Math.random().toString(36).slice(2, 14)}`,
    issued_on: dateOnly(-3), due_on: dateOnly(0),
    subtotal_ex_cents: 210000, gst_cents: 21000, total_inc_cents: 231000,
  }).select("id").single();
  die("invoice", inv.error);
  m.invoices.push(inv.data.id);
}

// 6 · Michael O'Donnell — visit done 9 days ago, gone quiet. Board says so;
//     Today deliberately does NOT, because the silence rules are 2A.4.
{
  const a = await account("michael", "Michael O'Donnell", { temperature: "warm" });
  const p = await property(a, "5 Studley Avenue", "Kew");
  const e = await estimate(a, p, { title: "Heritage exterior (demo)", status: "sent", total_cents: 2210000, sent_at: daysAgo(12), viewed_at: daysAgo(11), created_at: daysAgo(12) });
  await logEvent("estimate_sent", a, { totalCents: 2210000, channel: "email" }, daysAgo(12), { estimateId: e });
  await logEvent("visit_completed", a, { outcome: "Walked the exterior; wife wants colour samples first" }, daysAgo(9));
  await logEvent("call_no_answer", a, { note: "Second try, left a voicemail", voicemail: true }, daysAgo(2), { source: "staff" });
}

// 7 · Anh Nguyen — an open wizard draft at 85%, seen 3 hours ago, plan
//     uploaded. The board's Enquiry-unfinished lane and its worth-a-call chip.
{
  const a = await account("anh", "Anh Nguyen");
  await property(a, "112 Droop Street", "Footscray");
  const d = await sb.from("wizard_drafts").insert({
    account_id: a, state: {}, progress_pct: 85, uploaded: true, visits: 2,
    started_at: hoursAgo(20), last_seen_at: hoursAgo(3),
  }).select("id").single();
  die("wizard draft", d.error);
  m.drafts.push(d.data.id);
  await logEvent("wizard_started", a, { mode: "customer" }, hoursAgo(20));
}

// 8 · Two queued campaign messages → Today's single approvals item.
{
  const c = await sb.from("campaigns").insert({
    key: "demo-warranty-checkin", name: "Warranty check-in (demo)", segment_key: "past_customers", status: "live", steps: [],
  }).select("id").single();
  die("campaign", c.error);
  m.campaigns.push(c.data.id);
  for (const [i, accId] of [m.accounts[1], m.accounts[2]].entries()) {
    const en = await sb.from("campaign_enrolments").insert({ campaign_id: c.data.id, account_id: accId }).select("id").single();
    die("enrolment", en.error);
    m.enrolments.push(en.data.id);
    const msg = await sb.from("campaign_messages").insert({
      enrolment_id: en.data.id, account_id: accId, step: 1, channel: "email",
      state: "queued", send_key: `demo-warranty-${i}-${accId}`,
    }).select("id").single();
    die("campaign message", msg.error);
    m.campaignMessages.push(msg.data.id);
  }
}

writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
console.log(`Seeded on ${URL}`);
console.log(`accounts ${m.accounts.length} · estimates ${m.estimates.length} · invoices ${m.invoices.length} · drafts ${m.drafts.length} · queued messages ${m.campaignMessages.length}`);
console.log(`Manifest: ${MANIFEST} — remove everything with --yes-production --clean`);
