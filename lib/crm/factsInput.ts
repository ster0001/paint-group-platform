import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardInput } from "@/lib/crm/board";
import type { AccountFacts } from "@/lib/crm/stage";
import { journeyWho } from "@/lib/wizard/journey";

/**
 * CRM v2 P1 — the one fact-load behind a customer card, BY ACCOUNT ID.
 *
 * Before P1 this lived in app/crm/customers/data.ts and loaded "the first 500
 * accounts and the newest 2,000 events in the business", then ran the stage
 * rules over whatever it got. Now it loads exactly the accounts it is asked
 * for, in chunks, with every event those accounts have of the kinds the rules
 * read — and its output feeds `crm_account_facts` (lib/crm/facts.ts), which
 * is what the screens read. The Customers tab never calls this for a page
 * of customers any more; the refresher calls it for the accounts that changed.
 */

/** BoardInput plus what the facts row needs beyond the card. */
export type CustomerInput = BoardInput & {
  trade: boolean;
  email: string | null;
  ownerId: string | null;
  address: string | null;
  suburb: string | null;
  accountType: string;
  /** Every event of the kinds the facts row counts (opens, contacts). */
  allEvents: Array<{ type: string; occurred_at: string }>;
};

/** Event kinds the stage rules and the facts counters read. Nothing else is loaded. */
export const FACT_EVENT_TYPES = [
  "visit_booked", "visit_completed", "estimate_revised", "estimate_viewed", "note_added", "first_touch_recorded",
  "call_connected", "call_no_answer", "message_left", "sms_reply", "estimate_sent", "campaign_message_sent",
  "job_completed", "invoice_paid", "estimate_accepted", "estimate_declined", "estimate_lapsed", "account_merged",
] as const;

const CHUNK = 100;

export async function loadCustomerInputs(supabase: SupabaseClient, ids: string[]): Promise<CustomerInput[]> {
  const out: CustomerInput[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...await loadChunk(supabase, ids.slice(i, i + CHUNK)));
  }
  return out;
}

async function loadChunk(supabase: SupabaseClient, ids: string[]): Promise<CustomerInput[]> {
  if (ids.length === 0) return [];
  const [{ data: accounts, error: e1 }, { data: estimates, error: e2 }, { data: events, error: e3 }, { data: props, error: e4 }, { data: drafts, error: e5 }] =
    await Promise.all([
      supabase.from("accounts")
        .select("id, name, email, phone, account_type, temperature, snoozed_until, followup_due_at, owner_id")
        .in("id", ids),
      supabase.from("estimates")
        .select("id, account_id, status, total_cents, accepted_total_cents, created_at, sent_at, viewed_at, accepted_at, declined_at, title, job_kind")
        .in("account_id", ids).order("created_at", { ascending: false }).limit(ids.length * 50),
      supabase.from("crm_events")
        .select("account_id, type, occurred_at, payload")
        .in("type", [...FACT_EVENT_TYPES])
        .in("account_id", ids)
        .order("occurred_at", { ascending: false }).limit(ids.length * 200),
      supabase.from("properties").select("account_id, address, suburb, state, postcode").in("account_id", ids).limit(ids.length * 10),
      supabase.from("wizard_drafts")
        .select("account_id, progress_pct, uploaded, visits, est_value_cents, last_seen_at, converted_at, bucket, job_type, furthest_page, pages_total, active_seconds, entry_source")
        .in("account_id", ids)
        .order("last_seen_at", { ascending: false }).limit(ids.length * 5),
    ]);
  const err = e1 ?? e2 ?? e3 ?? e4 ?? e5;
  if (err) throw new Error(`facts load failed: ${err.message}`);

  type Est = NonNullable<typeof estimates>[number];
  const estByAccount = new Map<string, Est[]>();
  for (const e of estimates ?? []) {
    const list = estByAccount.get(e.account_id as string) ?? [];
    list.push(e);
    estByAccount.set(e.account_id as string, list);
  }
  const estimateIds = (estimates ?? []).map((e) => e.id as string);
  const { data: workOrders, error: e6 } = estimateIds.length
    ? await supabase.from("work_orders").select("estimate_id, status, start_date, end_date").in("estimate_id", estimateIds).limit(estimateIds.length * 3)
    : { data: [], error: null };
  if (e6) throw new Error(`facts load failed: ${e6.message}`);

  // Work orders hang off an estimate, so they reach the account through it.
  const accountOfEstimate = new Map((estimates ?? []).map((e) => [e.id as string, e.account_id as string]));
  const woByAccount = new Map<string, AccountFacts["workOrders"]>();
  for (const w of workOrders ?? []) {
    const acc = accountOfEstimate.get(w.estimate_id as string);
    if (!acc) continue;
    const list = woByAccount.get(acc) ?? [];
    list.push({ status: w.status as string, start_date: w.start_date as string | null, end_date: w.end_date as string | null });
    woByAccount.set(acc, list);
  }
  const evByAccount = new Map<string, Array<{ type: string; occurred_at: string; payload: Record<string, unknown> | null }>>();
  for (const e of events ?? []) {
    const list = evByAccount.get(e.account_id as string) ?? [];
    list.push({ type: e.type as string, occurred_at: e.occurred_at as string, payload: e.payload as Record<string, unknown> | null });
    evByAccount.set(e.account_id as string, list);
  }
  const propOf = new Map<string, { address: string | null; suburb: string | null; state: string | null; postcode: string | null }>();
  for (const p of props ?? []) {
    if (propOf.has(p.account_id as string)) continue;
    propOf.set(p.account_id as string, { address: p.address as string | null, suburb: p.suburb as string | null, state: p.state as string | null, postcode: p.postcode as string | null });
  }
  const draftOf = new Map<string, NonNullable<BoardInput["draft"]>>();
  for (const d of drafts ?? []) {
    const acc = d.account_id as string;
    if (draftOf.has(acc)) continue;         // newest draft wins
    draftOf.set(acc, {
      progressPct: (d.progress_pct as number) ?? 0,
      uploaded: d.uploaded === true,
      visits: (d.visits as number) ?? 1,
      estValueCents: (d.est_value_cents as number | null) ?? null,
      lastSeenAt: (d.last_seen_at as string) ?? "",
      bucket: (d.bucket as string | null) ?? null,
      jobType: (d.job_type as string | null) ?? null,
      furthestPage: (d.furthest_page as number | undefined) ?? undefined,
      pagesTotal: (d.pages_total as number | undefined) ?? undefined,
      activeSeconds: (d.active_seconds as number | undefined) ?? undefined,
      entrySource: (d.entry_source as string | null) ?? null,
      converted: d.converted_at != null,
    });
  }

  return (accounts ?? []).map((a) => {
    const est = estByAccount.get(a.id as string) ?? [];
    const evs = evByAccount.get(a.id as string) ?? [];
    const live = est.find((e) => !e.declined_at && e.status !== "declined" && e.status !== "expired");
    const prop = propOf.get(a.id as string);
    const suburb = prop?.suburb ?? "";
    const kind = (live?.job_kind as string) || "";
    const name = (a.name as string) || (a.email as string) || (a.phone as string) || "Unnamed";
    return {
      accountId: a.id as string,
      name,
      meta: [suburb, kind, a.account_type === "trade" ? "Trade account" : ""].filter(Boolean).join(" · ")
        || (live?.title as string) || "No property on file",
      // The open estimate's value; failing that, the newest one's — a lapsed
      // or declined quote still tells the office what was on the table.
      valueCents: (live?.total_cents as number | null) ?? (est[0]?.total_cents as number | null) ?? null,
      source: (evs.find((e) => e.type === "first_touch_recorded")?.payload?.source as string) ?? null,
      note: (evs.find((e) => e.type === "note_added")?.payload?.body as string) ?? null,
      phone: (a.phone as string | null) ?? null,
      draft: draftOf.get(a.id as string) ?? null,
      trade: a.account_type === "trade",
      email: (a.email as string | null) ?? null,
      ownerId: (a.owner_id as string | null) ?? null,
      address: prop ? [prop.address, prop.suburb, prop.state, prop.postcode].filter(Boolean).join(" ") || null : null,
      suburb: suburb || null,
      accountType: (a.account_type as string) ?? "residential",
      allEvents: evs.map((e) => ({ type: e.type, occurred_at: e.occurred_at })),
      facts: {
        estimates: est.map((e) => ({
          id: e.id as string, status: e.status as string, total_cents: e.total_cents as number | null,
          created_at: e.created_at as string, sent_at: e.sent_at as string | null,
          viewed_at: e.viewed_at as string | null, accepted_at: e.accepted_at as string | null,
          declined_at: e.declined_at as string | null,
        })),
        workOrders: woByAccount.get(a.id as string) ?? [],
        events: evs.map((e) => ({ type: e.type, occurred_at: e.occurred_at })),
        temperature: a.temperature as string | null,
        snoozedUntil: a.snoozed_until as string | null,
        followupDueAt: a.followup_due_at as string | null,
      },
    };
  });
}

export type SessionCard = BoardInput & { trade: false };

/**
 * Tom, 6 Sep: wizard sessions with NO account yet (no email typed) are cards
 * of their own — "an address is a lead". Open ones from the last 30 days.
 * They are not accounts, so they are not in crm_account_facts; the list and
 * board read them alongside.
 */
export async function loadSessionCards(supabase: SupabaseClient, limit = 100): Promise<SessionCard[]> {
  const { data: anonDrafts } = await supabase.from("wizard_drafts")
    .select("id, name, email, phone, address, suburb, job_type, mode, entry_source, bucket, outcome, outcome_note, furthest_page, pages_total, active_seconds, est_value_cents, last_seen_at, progress_pct, uploaded, visits, started_at")
    .is("account_id", null).is("converted_at", null)
    .gte("last_seen_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order("last_seen_at", { ascending: false }).limit(limit);

  return ((anonDrafts ?? []) as Record<string, unknown>[]).map((d) => ({
    accountId: `session:${d.id as string}`,
    sessionId: d.id as string,
    name: journeyWho({ name: d.name as string | null, email: d.email as string | null, address: d.address as string | null, suburb: d.suburb as string | null }),
    meta: [(d.address as string | null) || (d.suburb as string | null), d.job_type as string | null, d.mode === "business" ? "Business" : ""].filter(Boolean).join(" · ") || "No contact yet",
    valueCents: (d.est_value_cents as number | null) ?? null,
    source: (d.entry_source as string | null) ?? null,
    note: (d.outcome_note as string | null) ?? null,
    phone: (d.phone as string | null) ?? null,
    draft: {
      progressPct: (d.progress_pct as number) ?? 0, uploaded: d.uploaded === true, visits: (d.visits as number) ?? 1,
      estValueCents: (d.est_value_cents as number | null) ?? null, lastSeenAt: (d.last_seen_at as string) ?? "",
      bucket: (d.bucket as string | null) ?? null, jobType: (d.job_type as string | null) ?? null,
      furthestPage: (d.furthest_page as number | undefined) ?? undefined, pagesTotal: (d.pages_total as number | undefined) ?? undefined,
      activeSeconds: (d.active_seconds as number | undefined) ?? undefined, entrySource: (d.entry_source as string | null) ?? null,
      converted: false,
    },
    trade: false,
    facts: { estimates: [], workOrders: [], events: [], temperature: null, snoozedUntil: null, followupDueAt: null },
  }));
}
