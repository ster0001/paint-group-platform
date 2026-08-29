import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { describeCriterion, previewSegment, STANDING_SEGMENTS, toSubject, type SegmentSubject } from "@/lib/crm/segments";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const compact = (c: number) => (c >= 100_000_00 ? `$${Math.round(c / 100_000) / 10}k` : money(c));

/**
 * Segments (session 2.5) — the mockup's Segments tab.
 *
 * Standing lists only for now: they are the ones the campaigns depend on, and
 * a saved custom list needs a table, which needs the campaign session's
 * migration anyway. Each shows its criteria as the form rows the mockup draws,
 * with the live count and a sample underneath — nothing is ever sent to a list
 * nobody has looked at.
 */
export default async function SegmentsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s: chosenKey } = await searchParams;
  const segment = STANDING_SEGMENTS.find((s) => s.key === chosenKey) ?? STANDING_SEGMENTS[0];

  const supabase = await createClient();
  const [{ data: accounts }, { data: estimates }, { data: workOrders }, { data: events }, { data: props }] =
    await Promise.all([
      supabase.from("accounts").select("id, name, email, temperature, snoozed_until").limit(2000),
      // jobType comes from the WIZARD's answer inside builder_state. The
      // estimates.job_kind column is residential/commercial — it is
      // "residential" on all 25 live rows and says nothing about which
      // surfaces were painted, which is what a cross-sell list is asking.
      // ⚑ At volume this path-read wants materialising; noted for the gate.
      supabase.from("estimates")
        .select("id, account_id, status, accepted_at, accepted_total_cents, total_cents, created_at, sent_at, jobType:builder_state->wizard->state->jobType")
        .not("account_id", "is", null).limit(3000),
      supabase.from("work_orders").select("estimate_id, status, end_date").limit(2000),
      supabase.from("crm_events").select("account_id, occurred_at")
        .not("account_id", "is", null).order("occurred_at", { ascending: false }).limit(3000),
      supabase.from("properties").select("account_id, suburb").limit(2000),
    ]);

  const estByAccount = new Map<string, NonNullable<typeof estimates>>();
  for (const e of estimates ?? []) {
    const list = estByAccount.get(e.account_id as string) ?? [];
    list.push(e);
    estByAccount.set(e.account_id as string, list as NonNullable<typeof estimates>);
  }
  const accountOfEstimate = new Map((estimates ?? []).map((e) => [e.id as string, e.account_id as string]));
  const woByAccount = new Map<string, Array<{ status: string; end_date: string | null }>>();
  for (const w of workOrders ?? []) {
    const acc = accountOfEstimate.get(w.estimate_id as string);
    if (!acc) continue;
    const list = woByAccount.get(acc) ?? [];
    list.push({ status: w.status as string, end_date: w.end_date as string | null });
    woByAccount.set(acc, list);
  }
  const lastEventAt = new Map<string, string>();
  for (const e of events ?? []) {
    const acc = e.account_id as string;
    if (!lastEventAt.has(acc)) lastEventAt.set(acc, e.occurred_at as string);
  }
  const suburbOf = new Map((props ?? []).map((p) => [p.account_id as string, p.suburb as string | null]));

  const subjects: SegmentSubject[] = (accounts ?? []).map((a) => toSubject({
    accountId: a.id as string,
    name: (a.name as string) || (a.email as string),
    suburb: suburbOf.get(a.id as string) ?? null,
    temperature: a.temperature as string | null,
    snoozedUntil: a.snoozed_until as string | null,
    estimates: (estByAccount.get(a.id as string) ?? []).map((e) => ({
      status: e.status as string,
      accepted_at: e.accepted_at as string | null,
      jobType: e.jobType as string | null,
      total_cents: e.total_cents as number | null,
      accepted_total_cents: e.accepted_total_cents as number | null,
      created_at: e.created_at as string | null,
      sent_at: e.sent_at as string | null,
    })),
    workOrders: woByAccount.get(a.id as string) ?? [],
    lastEventAt: lastEventAt.get(a.id as string) ?? null,
  }));

  const preview = previewSegment(subjects, segment);
  // A customer whose jobs pre-date the wizard has no recorded surface, so a
  // job-type rule can never match them. Saying so stops a 0 being read as
  // "nobody qualifies" when it means "we don't know yet".
  const asksJobType = segment.criteria.some((c) => c.field === "job_type" || c.field === "has_job_type");
  const noJobType = subjects.filter((s) => s.wonCents > 0 && s.jobTypes.length === 0).length;

  return (
    <>
      <h2>Segments</h2>
      <p className="sub">
        Build a list once. Every campaign, count and report reads the same one — so what you preview
        here is exactly who gets the message.
      </p>

      <div className="chips" style={{ marginBottom: 16 }}>
        {STANDING_SEGMENTS.map((s) => (
          <Link key={s.key} href={`/crm/segments?s=${s.key}`} className={`chip ${s.key === segment.key ? "on" : ""}`}>
            {s.name}
          </Link>
        ))}
      </div>

      <div className="panel">
        <p className="plabel">Segment</p>
        <p className="segname">{segment.name}</p>
        <p className="segdesc">{segment.description}</p>

        <div className="rules">
          {segment.criteria.map((c, i) => {
            const d = describeCriterion(c);
            return (
              <div className="rule" key={i}>
                {i > 0 && <i className="and">and</i>}
                <span className="rfield">{d.field}</span>
                <span className="rop">{d.op}</span>
                <span className="rvalue">{d.value}</span>
              </div>
            );
          })}
        </div>
        <p className="relative">Dates are always relative, so this list stays right without anyone editing it.</p>
      </div>

      {asksJobType && noJobType > 0 && (
        <p className="partial">
          {noJobType} customer{noJobType === 1 ? " has" : "s have"} finished work with no interior/exterior
          recorded — jobs quoted before the wizard captured it. They cannot match a job-type rule,
          so this count is of what we know, not of everyone.
        </p>
      )}

      <div className="stats">
        <div className="stat">
          <span>Match today</span>
          <b>{preview.count}</b>
          <em>{preview.count === 1 ? "customer" : "customers"}</em>
        </div>
        <div className="stat">
          <span>Worth roughly</span>
          <b>{preview.worthCents == null ? "—" : compact(preview.worthCents)}</b>
          <em>{preview.averageCents == null
            ? "no finished jobs to average yet"
            : `at ${money(preview.averageCents)}, your average job`}</em>
        </div>
      </div>

      {preview.count === 0 ? (
        <p className="empty">
          Nobody matches this list today. That is the list being honest, not broken —
          it will fill as jobs finish and time passes.
        </p>
      ) : (
        <div className="people">
          {preview.sample.map((s) => (
            <Link key={s.accountId} className="person" href={`/crm?id=${s.accountId}`}>
              <span className="cname">{s.name}</span>
              <span className="cmeta">{s.detail || "No property on file"}</span>
            </Link>
          ))}
          {preview.count > preview.sample.length && (
            <p className="empty">+ {preview.count - preview.sample.length} more</p>
          )}
        </div>
      )}
    </>
  );
}
