import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardInput } from "@/lib/crm/board";
import type { AccountFacts } from "@/lib/crm/stage";

/**
 * One fact-load for the Customers tab, whichever shape it is wearing (§4.3):
 * the list and the board are the same customers through the same reads, and a
 * filter chosen in one survives the toggle because there is nothing else to
 * fall out of sync with.
 */
/** BoardInput plus the one flag the list's Trade chip filters on. */
export type CustomerInput = BoardInput & { trade: boolean };

export async function loadBoardInput(supabase: SupabaseClient): Promise<CustomerInput[]> {
  const [{ data: accounts }, { data: estimates }, { data: workOrders }, { data: events }, { data: props }, { data: drafts }] =
    await Promise.all([
      supabase.from("accounts")
        .select("id, name, email, phone, account_type, temperature, snoozed_until, followup_due_at").limit(500),
      supabase.from("estimates")
        .select("id, account_id, status, total_cents, created_at, sent_at, viewed_at, accepted_at, declined_at, title, job_kind")
        .not("account_id", "is", null).limit(2000),
      supabase.from("work_orders")
        .select("estimate_id, status, start_date, end_date").limit(1000),
      supabase.from("crm_events")
        .select("account_id, type, occurred_at, payload")
        .in("type", ["visit_booked", "visit_completed", "estimate_revised", "estimate_viewed", "note_added", "first_touch_recorded"])
        .not("account_id", "is", null)
        .order("occurred_at", { ascending: false }).limit(2000),
      supabase.from("properties").select("account_id, suburb").limit(1000),
      // C15: the open drafts — the drop-outs the enquiry lane exists for.
      supabase.from("wizard_drafts")
        .select("account_id, progress_pct, uploaded, visits, est_value_cents, last_seen_at, converted_at")
        .not("account_id", "is", null)
        .order("last_seen_at", { ascending: false }).limit(1000),
    ]);

  type Est = NonNullable<typeof estimates>[number];
  const estByAccount = new Map<string, Est[]>();
  for (const e of estimates ?? []) {
    const list = estByAccount.get(e.account_id as string) ?? [];
    list.push(e);
    estByAccount.set(e.account_id as string, list);
  }
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
  const suburbOf = new Map((props ?? []).map((p) => [p.account_id as string, p.suburb as string | null]));
  const draftOf = new Map<string, { progressPct: number; uploaded: boolean; visits: number; estValueCents: number | null; lastSeenAt: string }>();
  for (const d of drafts ?? []) {
    if (d.converted_at != null) continue;   // finished: a customer, not a drop-out
    const acc = d.account_id as string;
    if (draftOf.has(acc)) continue;         // newest open draft wins
    draftOf.set(acc, {
      progressPct: (d.progress_pct as number) ?? 0,
      uploaded: d.uploaded === true,
      visits: (d.visits as number) ?? 1,
      estValueCents: (d.est_value_cents as number | null) ?? null,
      lastSeenAt: (d.last_seen_at as string) ?? "",
    });
  }

  return (accounts ?? []).map((a) => {
    const est = estByAccount.get(a.id as string) ?? [];
    const evs = evByAccount.get(a.id as string) ?? [];
    const live = est.find((e) => !e.declined_at && e.status !== "declined");
    const suburb = suburbOf.get(a.id as string) ?? "";
    const kind = (live?.job_kind as string) || "";
    return {
      accountId: a.id as string,
      name: (a.name as string) || (a.email as string),
      meta: [suburb, kind, a.account_type === "trade" ? "Trade account" : ""].filter(Boolean).join(" · ")
        || (live?.title as string) || "No property on file",
      valueCents: (live?.total_cents as number | null) ?? null,
      source: (evs.find((e) => e.type === "first_touch_recorded")?.payload?.source as string) ?? null,
      note: (evs.find((e) => e.type === "note_added")?.payload?.body as string) ?? null,
      phone: (a.phone as string | null) ?? null,
      draft: draftOf.get(a.id as string) ?? null,
      trade: a.account_type === "trade",
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
