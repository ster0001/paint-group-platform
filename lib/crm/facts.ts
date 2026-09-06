import type { SupabaseClient } from "@supabase/supabase-js";
import { cardFor, type BoardCard } from "./board";
import { isWon } from "./stage";
import { loadCustomerInputs, type CustomerInput } from "./factsInput";

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

const CONTACT_KINDS = new Set(["call_connected", "call_no_answer", "message_left", "sms_reply", "estimate_sent", "campaign_message_sent", "visit_completed"]);

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
  stale: false;
  refreshed_at: string;
};

const maxIso = (...xs: Array<string | null | undefined>): string | null =>
  xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);

/** Pure: one customer's inputs → one facts row. Tested without a database. */
export function computeFactsRow(i: CustomerInput, now: Date = new Date()): FactsRow {
  const card = cardFor(i, now);
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
    stale: false,
    refreshed_at: now.toISOString(),
  };
}

/** Recompute and store the facts for these accounts. Returns how many rows were written. */
export async function refreshAccountFacts(db: SupabaseClient, ids: string[], now: Date = new Date()): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return 0;
  const inputs = await loadCustomerInputs(db, unique);
  const rows = inputs.map((i) => computeFactsRow(i, now));
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
  } catch {
    return null; // a failed refresh shows yesterday's card, never an error page
  }
}
