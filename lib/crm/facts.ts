import type { SupabaseClient } from "@supabase/supabase-js";
import { cardFor, type BoardCard } from "./board";
import { isWon } from "./stage";
import { loadCustomerInputs, type CustomerInput } from "./factsInput";
import { DEFAULT_THRESHOLDS, loadCrmThresholds, type CrmThresholds } from "./thresholds";
import { reportError } from "@/lib/monitoring/report";

/**
 * CRM v2 P1 — the facts layer (deep dive §3 F4, §6.2).
 *
 * `crm_account_facts` is the cached result of the stage rules per account:
 * the card exactly as `cardFor` computes it, plus the sort keys and counters
 * the list, the search and (P5) the audience rules read in SQL. This file is
 * the ONLY writer. It is not a second implementation of the rules — it calls
 * the same `cardFor`/`stageFor` the board always called and stores the answer.
 *
 * Staleness is marked by database triggers (migration 20270122) on every
 * table whose change can move a card. Refreshing happens three ways, all
 * through here: after a CRM write (one account), opportunistically on a CRM
 * read (a bounded batch of stale rows), and in full from the daily sweep.
 * A row that is stale is still shown — with yesterday's card — never hidden.
 */

/** P5: the customer reaching in — a reply, a text, a callback, a chat. */
const INBOUND_KINDS = new Set(["message_in", "sms_reply", "callback_requested", "website_chat"]);
/** P5: a person here reaching out by hand (never a campaign send). */
const STAFF_CONTACT_KINDS = new Set(["call_connected", "call_no_answer", "message_left", "email_logged", "sms_logged", "visit_completed"]);
const CONTACT_KINDS = new Set(["call_connected", "call_no_answer", "message_left", "sms_reply", "estimate_sent", "campaign_message_sent", "visit_completed", "email_logged", "sms_logged", "message_in", "message_out"]);

export type FactsRow = {
  account_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  suburb: string | null;
  account_type: string;
  temperature: string | null;
  owner_id: string | null;
  search: string;
  stage: string;
  stage_since: string | null;
  because: string;
  meta: string;
  chips: string[];
  flags: BoardCard["flags"];
  needs_you: boolean;
  wants_call: boolean;
  call_why: string[];
  value_cents: number | null;
  source: string | null;
  note: string | null;
  draft_bucket: string | null;
  draft_last_seen_at: string | null;
  quote_at: string | null;
  last_activity_at: string | null;
  last_contact_at: string | null;
  opened_count: number;
  last_opened_at: string | null;
  estimates_count: number;
  open_value_cents: number;
  won_cents: number;
  last_job_completed_at: string | null;
  next_followup_at: string | null;
  snoozed_until: string | null;
  relationship_state: string;
  state_until: string | null;
  state_note: string | null;
  lost_reason: string | null;
  tags: string[];
  permit_email: string;
  permit_sms: string;
  permit_phone: string;
  last_job_completed_type: string | null;
  repaint_due_at: string | null;
  /** P5 — the audience facts (migration 20270126). */
  last_sent_at: string | null;
  last_estimate_status: "none" | "draft" | "sent" | "accepted" | "declined" | "lapsed";
  last_accepted_at: string | null;
  last_declined_at: string | null;
  decline_reason: string | null;
  job_types: string[];
  quoted_cents: number | null;
  dwell_seconds: number;
  invoice_state: "none" | "open" | "overdue" | "paid";
  invoice_due_on: string | null;
  campaigns_received: string[];
  last_inbound_at: string | null;
  last_inbound_call_at: string | null;
  last_staff_contact_at: string | null;
  stale: false;
  refreshed_at: string;
};

const addYears = (iso: string, years: number) => { const d = new Date(iso); d.setFullYear(d.getFullYear() + years); return d.toISOString(); };

const maxIso = (...xs: Array<string | null | undefined>): string | null =>
  xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);

/** Pure: one customer's inputs → one facts row. Tested without a database. */
export function computeFactsRow(i: CustomerInput, now: Date = new Date(), t: CrmThresholds = DEFAULT_THRESHOLDS): FactsRow {
  const card = cardFor(i, now, t);
  const est = i.facts.estimates;
  const opens = i.allEvents.filter((e) => e.type === "estimate_viewed");
  const quoteAt = est.reduce<string | null>((m, e) => {
    if (!e.sent_at && e.status === "draft") return m;
    const at = e.sent_at ?? e.created_at;
    return !m || at > m ? at : m;
  }, null);
  const lastActivity = maxIso(
    ...i.allEvents.map((e) => e.occurred_at),
    ...est.flatMap((e) => [e.created_at, e.sent_at, e.accepted_at, e.declined_at]),
    ...i.facts.workOrders.flatMap((w) => [w.start_date, w.end_date]),
    i.draft?.lastSeenAt,
  );
  const lastContact = maxIso(...i.allEvents.filter((e) => CONTACT_KINDS.has(e.type)).map((e) => e.occurred_at));
  const openEstimates = est.filter((e) => (e.sent_at || e.status === "sent") && !isWon(e) && e.status !== "declined" && e.status !== "expired" && !e.declined_at);
  const lastJobCompleted = maxIso(
    ...i.facts.workOrders.filter((w) => w.status === "complete").map((w) => w.end_date),
    ...i.allEvents.filter((e) => e.type === "job_completed").map((e) => e.occurred_at),
  );
  const search = [i.name, i.email, i.phone, i.phone?.replace(/\s+/g, ""), i.suburb, i.address]
    .filter(Boolean).join(" ").toLowerCase();
  // Repaint due (decision 8.8): from the last completed job and its type.
  const lastType = i.jobTypes.find((j) => j.type)?.type ?? null;
  const years = lastType === "exterior" ? t.repaintExteriorYears : lastType === "interior" ? t.repaintInteriorYears : t.repaintUnknownYears;
  const repaintDue = lastJobCompleted ? addYears(lastJobCompleted, years) : null;

  // P5 — the audience facts. The estimate list arrives newest first.
  const newest = est[0];
  const lastEstimateStatus: FactsRow["last_estimate_status"] = !newest ? "none"
    : isWon(newest) ? "accepted"
    : newest.declined_at || newest.status === "declined" ? "declined"
    : newest.status === "expired" ? "lapsed"
    : newest.sent_at || newest.status === "sent" ? "sent"
    : "draft";
  const jobTypes = new Set<string>();
  for (const t of i.allJobTypes ?? []) {
    const k = t.toLowerCase();
    if (k === "interior" || k === "both") jobTypes.add("interior");
    if (k === "exterior" || k === "both") jobTypes.add("exterior");
  }
  const inv = i.invoice ?? null;
  const today = now.toISOString().slice(0, 10);
  const invoiceState: FactsRow["invoice_state"] = !inv || inv.status === "draft" || inv.status === "void" || inv.status === "written_off" ? "none"
    : inv.status === "paid" ? "paid"
    : inv.dueOn && inv.dueOn < today ? "overdue"
    : "open";

  return {
    account_id: i.accountId,
    name: i.name,
    email: i.email,
    phone: i.phone,
    suburb: i.suburb,
    account_type: i.accountType,
    temperature: i.facts.temperature,
    owner_id: i.ownerId,
    search,
    stage: card.stage,
    stage_since: card.since,
    because: card.because,
    meta: card.meta,
    chips: card.chips,
    flags: card.flags,
    needs_you: card.needsYou,
    wants_call: card.wantsCall,
    call_why: card.callWhy,
    value_cents: card.valueCents,
    source: card.source,
    note: card.note,
    draft_bucket: i.draft?.bucket ?? null,
    draft_last_seen_at: i.draft?.lastSeenAt || null,
    quote_at: quoteAt,
    last_activity_at: lastActivity,
    last_contact_at: lastContact,
    opened_count: opens.length,
    last_opened_at: maxIso(...opens.map((e) => e.occurred_at)),
    estimates_count: est.length,
    open_value_cents: openEstimates.reduce((s, e) => s + (e.total_cents ?? 0), 0),
    won_cents: est.filter(isWon).reduce((s, e) => s + (e.total_cents ?? 0), 0),
    last_job_completed_at: lastJobCompleted,
    next_followup_at: i.facts.followupDueAt,
    snoozed_until: i.facts.snoozedUntil,
    relationship_state: i.relationshipState,
    state_until: i.stateUntil,
    state_note: i.stateNote,
    lost_reason: i.lostReason ?? null,
    tags: i.tags ?? [],
    permit_email: i.permitEmail,
    permit_sms: i.permitSms,
    permit_phone: i.permitPhone ?? "unknown",
    last_job_completed_type: lastType,
    repaint_due_at: repaintDue,
    last_sent_at: maxIso(...est.map((e) => e.sent_at)),
    last_estimate_status: lastEstimateStatus,
    last_accepted_at: maxIso(...est.map((e) => e.accepted_at)),
    last_declined_at: maxIso(...est.map((e) => e.declined_at)),
    decline_reason: i.declineReason ?? null,
    job_types: [...jobTypes],
    quoted_cents: newest?.total_cents ?? null,
    dwell_seconds: i.dwellSeconds ?? 0,
    invoice_state: invoiceState,
    invoice_due_on: inv?.dueOn ?? null,
    campaigns_received: i.campaignsReceived ?? [],
    last_inbound_at: maxIso(...i.allEvents.filter((e) => INBOUND_KINDS.has(e.type)).map((e) => e.occurred_at)),
    last_inbound_call_at: maxIso(...i.allEvents.filter((e) => e.type === "callback_requested" || (e.type === "message_in" && e.channel === "call")).map((e) => e.occurred_at)),
    last_staff_contact_at: maxIso(...i.allEvents.filter((e) => STAFF_CONTACT_KINDS.has(e.type)).map((e) => e.occurred_at)),
    stale: false,
    refreshed_at: now.toISOString(),
  };
}

/** Recompute and store the facts for these accounts. Returns how many rows were written. */
export async function refreshAccountFacts(db: SupabaseClient, ids: string[], now: Date = new Date()): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return 0;
  const [inputs, thresholds] = await Promise.all([loadCustomerInputs(db, unique), loadCrmThresholds(db)]);
  const rows = inputs.map((i) => computeFactsRow(i, now, thresholds));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("crm_account_facts").upsert(rows.slice(i, i + 500), { onConflict: "account_id" });
    if (error) throw new Error(`facts upsert failed: ${error.message}`);
  }
  // An account that vanished between the mark and the load has no row to write.
  return rows.length;
}

export type RefreshResult = { refreshed: number; remaining: number };

/** Refresh up to `limit` stale rows, oldest refresh first. */
export async function refreshStaleFacts(db: SupabaseClient, limit = 500, now: Date = new Date()): Promise<RefreshResult> {
  const { data, error, count } = await db.from("crm_account_facts")
    .select("account_id", { count: "exact" })
    .eq("stale", true)
    .order("refreshed_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`stale read failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.account_id as string);
  const refreshed = await refreshAccountFacts(db, ids, now);
  return { refreshed, remaining: Math.max((count ?? 0) - refreshed, 0) };
}

/** Rebuild every row — the "derived and rebuildable" guarantee, made runnable. */
export async function rebuildAllFacts(db: SupabaseClient, now: Date = new Date(), onProgress?: (done: number) => void): Promise<number> {
  let done = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("accounts").select("id").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length === 0) break;
    done += await refreshAccountFacts(db, ids, now);
    onProgress?.(done);
    if (ids.length < 1000) break;
  }
  return done;
}

// ---- opportunistic refresh on read ------------------------------------------
// Same shape as lib/wizard/sweep.ts maybeSweep: a per-instance throttle so a
// busy office does not run the refresher on every click, and a small batch so
// a page never waits long. The daily sweep does the rest.
let lastOpportunistic = 0;
const OPPORTUNISTIC_EVERY_MS = 30_000;

export async function maybeRefreshFacts(db: SupabaseClient, limit = 200): Promise<RefreshResult | null> {
  const now = Date.now();
  if (now - lastOpportunistic < OPPORTUNISTIC_EVERY_MS) return null;
  lastOpportunistic = now;
  try {
    return await refreshStaleFacts(db, limit);
  } catch (e) {
    reportError(e, { where: "facts.maybeRefresh", bestEffort: true });
    return null; // a failed refresh shows yesterday's card, never an error page
  }
}
