import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildBoard, type BoardInput } from "@/lib/crm/board";
import type { AccountFacts } from "@/lib/crm/stage";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const compact = (c: number) => (c >= 100_000_00 ? `$${Math.round(c / 100_000) / 10}k` : money(c));

/**
 * The pipeline board (session 2.3) — crm-board-mockup.html's lanes.
 *
 * Nothing here is stored: every card's lane comes from `stageFor`, which reads
 * the estimates, work orders and events. Which is why there is no drag handle
 * on a card, and why the header says so out loud.
 */
export default async function PipelinePage() {
  const supabase = await createClient();

  const [{ data: accounts }, { data: estimates }, { data: workOrders }, { data: events }, { data: props }] =
    await Promise.all([
      supabase.from("accounts")
        .select("id, name, email, account_type, temperature, snoozed_until, followup_due_at").limit(500),
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

  const input: BoardInput[] = (accounts ?? []).map((a) => {
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

  const board = buildBoard(input);

  return (
    <>
      <h2>{board.open} open, {board.needsYou} need you today</h2>
      <p className="sub">Cards move on their own when the facts change. Nothing here is dragged.</p>

      <div className="tiles">
        <div className="tile"><b>{board.tiles.overdueFollowups}</b><span>Overdue follow-up</span></div>
        <div className="tile"><b>{board.tiles.goingCold}</b><span>Going cold</span></div>
        <div className="tile"><b>{compact(board.tiles.openValueCents)}</b><span>Open estimate value</span></div>
        <div className="tile">
          <b>{board.tiles.winRatePct == null ? "—" : `${board.tiles.winRatePct}%`}</b>
          <span>{board.tiles.winRatePct == null ? "Nothing decided yet" : `Win rate, 90 days · ${board.tiles.winRateOf} decided`}</span>
        </div>
      </div>

      <div className="lanescroll">
        {board.lanes.map((lane) => (
          <div className="lane" key={lane.key}>
            <div className="lanehead">
              <span className="lanename">{lane.label}</span>
              <span className="lanecount mono">{lane.cards.length}</span>
            </div>
            <div className="lanebar">
              <i style={{ width: `${lane.cards.length === 0 ? 0 : Math.min(100, lane.cards.length * 18)}%` }} />
            </div>

            {lane.cards.length === 0 && <p className="laneempty">Nobody here</p>}

            {lane.cards.map((c) => (
              <Link
                key={c.accountId}
                href={`/crm?id=${c.accountId}`}
                className={`card ${c.chips.includes("Follow-up overdue") ? "warnclay" : c.needsYou ? "warnamber" : ""}`}
              >
                <span className="cname">
                  {c.temperature && <i className={`dot ${c.temperature}`} aria-hidden="true" />}
                  {c.name}
                </span>
                <span className="cmeta">{c.meta}</span>
                <span className="cfoot">
                  <b className="cval">{c.valueCents ? money(c.valueCents) : "—"}</b>
                  <span className="cwhen mono">{c.because}</span>
                </span>
                {(c.chips.length > 0 || c.source) && (
                  <span className="cchips">
                    {c.chips.map((chip) => (
                      <i key={chip} className={`cchip ${chip === "Follow-up overdue" ? "bad" : "warn"}`}>{chip}</i>
                    ))}
                    {c.source && <i className="cchip">{c.source}</i>}
                  </span>
                )}
                {c.note && <span className="cnote">&ldquo;{c.note}&rdquo;</span>}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <p className="swipe">Seven lanes — scroll across →</p>
    </>
  );
}
