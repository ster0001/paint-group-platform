import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardCard } from "@/lib/crm/board";
import { LANES, OPEN_LANES, type LaneKey } from "@/lib/crm/stage";
import { cardFor } from "@/lib/crm/board";
import { loadSessionCards } from "@/lib/crm/factsInput";
import { maybeRefreshFacts, refreshAccountFacts } from "@/lib/crm/facts";

/**
 * The Customers tab's reads (CRM v2 P1). Both shapes — list and board — read
 * `crm_account_facts`, the cached card per account, through SQL: filter,
 * search, sort, page and count all happen in the database. Nothing here
 * loads "all the accounts" any more; the heading says "showing 50 of 312"
 * because 312 is a count query, not the length of a truncated array.
 *
 * Wizard sessions with no account yet are not accounts and have no facts row;
 * they ride alongside as session cards (Tom, 6 Sep: "an address is a lead").
 */

export const SORTS = [
  { key: "quote-new", label: "Quote date — newest first", hint: "Chase while it's warm" },
  { key: "quote-old", label: "Quote date — oldest first", hint: "Rescue the ones going cold" },
  { key: "activity", label: "Last activity", hint: "Who you dealt with most recently" },
  { key: "value", label: "Value — highest first", hint: "Where the money is" },
  { key: "untouched", label: "Longest untouched", hint: "Who's been forgotten" },
] as const;
export type SortKey = (typeof SORTS)[number]["key"];

/** Groups per the workflow mockup, MINUS "Waiting on you" — those customers
 *  live in Today (§2.2). One fact, one home. P1 adds Lapsed and Lost. */
export const GROUPS = [
  { key: "all", label: "All" },
  { key: "leads", label: "Leads" },
  { key: "quoted", label: "Quote sent" },
  { key: "lapsed", label: "Lapsed" },
  { key: "live", label: "Live work" },
  { key: "past", label: "Past customers" },
  { key: "lost", label: "Lost" },
  { key: "trade", label: "Trade & B2B" },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];
type LaneGroup = Exclude<GroupKey, "all" | "trade">;

export const LANE_GROUP: Record<LaneKey, LaneGroup> = {
  online_now: "leads",
  wizard_ready: "leads",
  wizard_help: "leads",
  wizard_dropped: "leads",
  wizard_priced: "leads",
  enquiry_unfinished: "leads",
  visit_booked: "leads",
  estimate_sent: "quoted",
  visit_done_no_reply: "quoted",
  negotiating: "quoted",
  lapsed: "lapsed",
  job_on: "live",
  past_customer: "past",
  lost: "lost",
};

const lanesOf = (g: GroupKey): LaneKey[] | null =>
  g === "all" || g === "trade" ? null : (Object.keys(LANE_GROUP) as LaneKey[]).filter((k) => LANE_GROUP[k] === g);

/** A facts row, as the list and board read it. */
export type FactsCard = BoardCard & {
  quoteAt: string | null;
  lastActivityAt: string | null;
  /** True for a wizard session with no account (no facts row). */
  session: boolean;
  stale: boolean;
};

const FACT_COLUMNS = "account_id, name, meta, because, chips, flags, needs_you, wants_call, call_why, value_cents, source, note, phone, temperature, stage, stage_since, quote_at, last_activity_at, stale";

type FactsRowRead = {
  account_id: string; name: string | null; meta: string; because: string; chips: string[]; flags: BoardCard["flags"];
  needs_you: boolean; wants_call: boolean; call_why: string[]; value_cents: number | null; source: string | null;
  note: string | null; phone: string | null; temperature: string | null; stage: string; stage_since: string | null;
  quote_at: string | null; last_activity_at: string | null; stale: boolean;
};

const EMPTY_FLAGS: BoardCard["flags"] = { chaseDue: false, followupOverdue: false, goingCold: false, snoozed: false, secondAttemptDue: false };

function toCard(r: FactsRowRead): FactsCard {
  return {
    accountId: r.account_id,
    href: `/crm/customers/${r.account_id}`,
    name: r.name || "Unnamed",
    meta: r.meta,
    valueCents: r.value_cents == null ? null : Number(r.value_cents),
    source: r.source,
    note: r.note,
    because: r.because,
    phone: r.phone,
    callWhy: r.call_why ?? [],
    wantsCall: r.wants_call,
    temperature: r.temperature,
    stage: r.stage as LaneKey,
    since: r.stage_since,
    flags: { ...EMPTY_FLAGS, ...(r.flags ?? {}) },
    needsYou: r.needs_you,
    chips: r.chips ?? [],
    quoteAt: r.quote_at,
    lastActivityAt: r.last_activity_at,
    session: false,
    stale: r.stale,
  };
}

function sessionToCard(s: Awaited<ReturnType<typeof loadSessionCards>>[number], now: Date): FactsCard {
  const c = cardFor(s, now);
  return { ...c, quoteAt: null, lastActivityAt: s.draft?.lastSeenAt ?? null, session: true, stale: false };
}

const ORDER: Record<SortKey, { column: string; ascending: boolean; nullsFirst: boolean }> = {
  "quote-new": { column: "quote_at", ascending: false, nullsFirst: false },
  // Oldest first — but "never quoted" is not "quoted long ago"; they sink.
  "quote-old": { column: "quote_at", ascending: true, nullsFirst: false },
  activity: { column: "last_activity_at", ascending: false, nullsFirst: false },
  value: { column: "value_cents", ascending: false, nullsFirst: false },
  untouched: { column: "last_activity_at", ascending: true, nullsFirst: true },
};

export type ListQuery = { sort: SortKey; filter: GroupKey; q: string; page: number; pageSize: number };

export type ListPage = {
  rows: FactsCard[];
  /** Matching accounts, from a count query — never a truncated length. */
  total: number;
  /** Session-only cards shown above page 1 of All / Leads. */
  sessions: FactsCard[];
  counts: Record<GroupKey, number>;
  page: number;
  pageSize: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the PostgREST builder's
   generic chain is too deep for TS to carry through a helper (TS2589). */
function applyFilter(qb: any, filter: GroupKey, q: string): any {
  const lanes = lanesOf(filter);
  if (lanes) qb = qb.in("stage", lanes);
  if (filter === "trade") qb = qb.eq("account_type", "trade");
  const needle = q.trim().toLowerCase().replace(/[%_]/g, "");
  if (needle) qb = qb.ilike("search", `%${needle}%`);
  return qb;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A row on the page that is stale gets recomputed before it is shown — the
 * page is a bounded set, so this is one small load, and nobody ever reads
 * yesterday's card for a customer they are looking at right now.
 */
async function freshen(db: SupabaseClient, rows: FactsRowRead[], now: Date): Promise<FactsRowRead[]> {
  const stale = rows.filter((r) => r.stale).map((r) => r.account_id);
  if (stale.length === 0) return rows;
  try {
    await refreshAccountFacts(db, stale, now);
    const { data } = await db.from("crm_account_facts").select(FACT_COLUMNS).in("account_id", stale);
    const fresh = new Map(((data ?? []) as unknown as FactsRowRead[]).map((r) => [r.account_id, r]));
    return rows.map((r) => fresh.get(r.account_id) ?? r);
  } catch {
    return rows; // yesterday's card beats an error page
  }
}

/** Chip counts: one grouped query for lanes, one count for trade. */
export async function loadCounts(db: SupabaseClient): Promise<Record<GroupKey, number>> {
  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<GroupKey, number>;
  const [{ data: byStage }, { count: trade }] = await Promise.all([
    db.rpc("crm_board_counts"),
    db.from("crm_account_facts").select("account_id", { count: "exact", head: true }).eq("account_type", "trade"),
  ]);
  for (const r of (byStage ?? []) as Array<{ stage: string; cards: number }>) {
    const g = LANE_GROUP[r.stage as LaneKey];
    const n = Number(r.cards);
    counts.all += n;
    if (g) counts[g] += n;
  }
  counts.trade = trade ?? 0;
  return counts;
}

export async function loadCustomerPage(db: SupabaseClient, query: ListQuery, now: Date = new Date()): Promise<ListPage> {
  await maybeRefreshFacts(db);
  const from = (query.page - 1) * query.pageSize;
  const order = ORDER[query.sort];
  const qb = applyFilter(db.from("crm_account_facts").select(FACT_COLUMNS, { count: "exact" }), query.filter, query.q);
  const [{ data, error, count }, counts, sessions] = await Promise.all([
    qb.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst })
      .order("account_id", { ascending: true })
      .range(from, from + query.pageSize - 1),
    loadCounts(db),
    query.page === 1 && !query.q.trim() && (query.filter === "all" || query.filter === "leads")
      ? loadSessionCards(db, 100) : Promise.resolve([]),
  ]);
  if (error) throw new Error(`customers read failed: ${error.message}`);
  const sessionCards = sessions.map((s) => sessionToCard(s, now));
  counts.all += sessionCards.length;
  counts.leads += sessionCards.length;
  return {
    rows: (await freshen(db, (data ?? []) as unknown as FactsRowRead[], now)).map(toCard),
    total: count ?? 0,
    sessions: sessionCards,
    counts,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// ---- the board -------------------------------------------------------------

export type BoardLane = { key: LaneKey; label: string; count: number; needsYou: number; cards: FactsCard[] };
export type BoardData = {
  lanes: BoardLane[];
  open: number;
  needsYou: number;
  tiles: { overdueFollowups: number; goingCold: number; openValueCents: number; winRatePct: number | null; winRateOf: number };
  perLane: number;
};

/** The board: every lane's count from SQL, the top `perLane` cards per lane. */
export async function loadBoard(db: SupabaseClient, filter: GroupKey, q: string, perLane = 25, now: Date = new Date()): Promise<BoardData> {
  await maybeRefreshFacts(db);
  const lanes = lanesOf(filter) ?? LANES.map((l) => l.key);
  const [{ data: countRows }, tiles, sessions, ...laneReads] = await Promise.all([
    db.rpc("crm_board_counts"),
    db.rpc("crm_board_tiles", { p_stages: lanesOf(filter) }),
    !q.trim() && (filter === "all" || filter === "leads") ? loadSessionCards(db, 100) : Promise.resolve([]),
    ...lanes.map((lane) =>
      applyFilter(db.from("crm_account_facts").select(FACT_COLUMNS).eq("stage", lane), filter === "trade" ? "trade" : "all", q)
        .order("needs_you", { ascending: false }).order("value_cents", { ascending: false, nullsFirst: false }).limit(perLane)),
  ]);
  const countOf = new Map<string, { cards: number; needsYou: number }>();
  for (const r of (countRows ?? []) as Array<{ stage: string; cards: number; needs_you: number }>) {
    countOf.set(r.stage, { cards: Number(r.cards), needsYou: Number(r.needs_you) });
  }
  const sessionCards = sessions.map((s) => sessionToCard(s, now));
  const laneRows = await Promise.all(lanes.map((_, i) => {
    const read = laneReads[i] as { data: unknown; error: { message: string } | null };
    if (read.error) throw new Error(`board read failed: ${read.error.message}`);
    return freshen(db, (read.data ?? []) as FactsRowRead[], now);
  }));
  const laneData: BoardLane[] = lanes.map((key, i) => {
    const cards = (laneRows[i] ?? []).map(toCard);
    const extra = sessionCards.filter((s) => s.stage === key);
    const c = countOf.get(key) ?? { cards: 0, needsYou: 0 };
    return {
      key,
      label: LANES.find((l) => l.key === key)!.label,
      count: c.cards + extra.length,
      needsYou: c.needsYou + extra.filter((s) => s.needsYou).length,
      cards: [...extra, ...cards],
    };
  });
  const t = ((tiles.data ?? []) as Array<{ overdue_followups: number; going_cold: number; open_value_cents: number; won_90d: number; lost_90d: number }>)[0];
  const decided = Number(t?.won_90d ?? 0) + Number(t?.lost_90d ?? 0);
  const openLanes = laneData.filter((l) => OPEN_LANES.includes(l.key));
  return {
    lanes: laneData,
    open: openLanes.reduce((s, l) => s + l.count, 0),
    needsYou: openLanes.reduce((s, l) => s + l.needsYou, 0),
    tiles: {
      overdueFollowups: Number(t?.overdue_followups ?? 0),
      goingCold: Number(t?.going_cold ?? 0),
      openValueCents: Number(t?.open_value_cents ?? 0) + sessionCards.reduce((s, c) => s + (c.valueCents ?? 0), 0),
      winRatePct: decided === 0 ? null : Math.round((Number(t?.won_90d ?? 0) / decided) * 100),
      winRateOf: decided,
    },
    perLane,
  };
}
