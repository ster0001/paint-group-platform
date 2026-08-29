/**
 * Loading the customer facts every CRM surface reasons over — once.
 *
 * The segments preview, the campaign dry run and (later) the sweep all need
 * the same flattened picture of a customer. Loading it in three places is how
 * the preview and the send end up disagreeing, which is the exact failure the
 * one-evaluator rule exists to prevent. So it is loaded here, and they all
 * call this.
 *
 * SERVER ONLY — takes a Supabase client rather than making one, so a staff
 * session, the service client or a test stub all work.
 */

import { toSubject, type SegmentSubject } from "./segments";

type Client = {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null }>;
      not: (col: string, op: string, val: unknown) => {
        limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null }>;
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null }>;
        };
      };
    };
  };
};

export type LoadedSubject = SegmentSubject & {
  email: string;
  /** For the guard chain, which asks questions a segment does not. */
  unsubscribedAt: string | null;
  undeliverableAt: string | null;
  lastMarketingAt: string | null;
  acceptedAt: string | null;
  snoozedUntil: string | null;
};

export async function loadSubjects(db: Client, now: Date = new Date()): Promise<LoadedSubject[]> {
  const [accounts, estimates, workOrders, events, props, sent] = await Promise.all([
    db.from("accounts").select(
      "id, name, email, temperature, snoozed_until, marketing_unsubscribed_at, marketing_undeliverable_at",
    ).limit(2000),
    db.from("estimates").select(
      "id, account_id, status, accepted_at, accepted_total_cents, total_cents, created_at, sent_at, jobType:builder_state->wizard->state->jobType",
    ).not("account_id", "is", null).limit(3000),
    db.from("work_orders").select("estimate_id, status, end_date").limit(2000),
    db.from("crm_events").select("account_id, occurred_at").not("account_id", "is", null)
      .order("occurred_at", { ascending: false }).limit(3000),
    db.from("properties").select("account_id, suburb").limit(2000),
    // What marketing has already gone out, for the frequency check.
    db.from("campaign_messages").select("account_id, sent_at").not("sent_at", "is", null)
      .order("sent_at", { ascending: false }).limit(3000),
  ]);

  const rows = <T,>(r: { data: T[] | null }) => r.data ?? [];
  const estimateRows = rows(estimates);

  const estByAccount = new Map<string, Record<string, unknown>[]>();
  for (const e of estimateRows) {
    const key = e.account_id as string;
    estByAccount.set(key, [...(estByAccount.get(key) ?? []), e]);
  }
  const accountOfEstimate = new Map(estimateRows.map((e) => [e.id as string, e.account_id as string]));
  const woByAccount = new Map<string, Array<{ status: string; end_date: string | null }>>();
  for (const w of rows(workOrders)) {
    const acc = accountOfEstimate.get(w.estimate_id as string);
    if (!acc) continue;
    woByAccount.set(acc, [...(woByAccount.get(acc) ?? []),
      { status: w.status as string, end_date: w.end_date as string | null }]);
  }
  const firstOf = <T extends Record<string, unknown>>(list: T[], key: string, field: string) => {
    const m = new Map<string, string>();
    for (const r of list) {
      const k = r[key] as string;
      if (k && !m.has(k)) m.set(k, r[field] as string);
    }
    return m;
  };
  const lastEventAt = firstOf(rows(events), "account_id", "occurred_at");
  const lastMarketingAt = firstOf(rows(sent), "account_id", "sent_at");
  const suburbOf = new Map(rows(props).map((p) => [p.account_id as string, p.suburb as string | null]));

  return rows(accounts).map((a) => {
    const id = a.id as string;
    const est = (estByAccount.get(id) ?? []).map((e) => ({
      status: e.status as string,
      accepted_at: e.accepted_at as string | null,
      jobType: e.jobType as string | null,
      total_cents: e.total_cents as number | null,
      accepted_total_cents: e.accepted_total_cents as number | null,
      created_at: e.created_at as string | null,
      sent_at: e.sent_at as string | null,
    }));
    const subject = toSubject({
      accountId: id,
      name: (a.name as string) || (a.email as string),
      suburb: suburbOf.get(id) ?? null,
      temperature: a.temperature as string | null,
      snoozedUntil: a.snoozed_until as string | null,
      unsubscribed: a.marketing_unsubscribed_at != null,
      estimates: est,
      workOrders: woByAccount.get(id) ?? [],
      lastEventAt: lastEventAt.get(id) ?? null,
    }, now);

    return {
      ...subject,
      email: a.email as string,
      unsubscribedAt: (a.marketing_unsubscribed_at as string | null) ?? null,
      undeliverableAt: (a.marketing_undeliverable_at as string | null) ?? null,
      lastMarketingAt: lastMarketingAt.get(id) ?? null,
      acceptedAt: est.map((e) => e.accepted_at).filter(Boolean).sort().reverse()[0] ?? null,
      snoozedUntil: (a.snoozed_until as string | null) ?? null,
    };
  });
}
