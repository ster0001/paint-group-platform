import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardCard } from "@/lib/crm/board";
import { LANES, OPEN_LANES, type LaneKey } from "@/lib/crm/stage";
import { cardFor } from "@/lib/crm/board";
import { loadSessionCards } from "@/lib/crm/factsInput";
import { maybeRefreshFacts, refreshAccountFacts } from "@/lib/crm/facts";
import { loadCrmThresholds, type CrmThresholds } from "@/lib/crm/thresholds";
import { reportError } from "@/lib/monitoring/report";

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
  relationshipState: string;
  tags: string[];
  quoteAt: string | null;
  lastActivityAt: string | null;
  /** True for a wizard session with no account (no facts row). */
  session: boolean;
  stale: boolean;
};

const FACT_COLUMNS = "account_id, name, meta, because, chips, flags, needs_you, wants_call, call_why, value_cents, source, note, phone, temperature, stage, stage_since, quote_at, last_activity_at, stale, relationship_state, tags";

type FactsRowRead = {
  account_id: string; name: string | null; meta: string; because: string; chips: string[]; flags: BoardCard["flags"];
  needs_you: boolean; wants_call: boolean; call_why: string[]; value_cents: number | null; source: string | null;
  note: string | null; phone: string | null; temperature: string | null; stage: string; stage_since: string | null;
  quote_at: string | null; last_activity_at: string | null; stale: boolean;
  relationship_state?: string; tags?: string[];
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
    relationshipState: r.relationship_state ?? "active",
    tags: r.tags ?? [],
    session: false,
    stale: r.stale,
  };
}

function sessionToCard(s: Awaited<ReturnType<typeof loadSessionCards>>[number], now: Date): FactsCard {
  const c = cardFor(s, now);
  return { ...c, quoteAt: null, lastActivityAt: s.draft?.lastSeenAt ?? null, relationshipState: "active", tags: [], session: true, stale: false };
}

const ORDER: Record<SortKey, { column: string; ascending: boolean; nullsFirst: boolean }> = {
  "quote-new": { column: "quote_at", ascending: false, nullsFirst: false },
  // Oldest first — but "never quoted" is not "quoted long ago"; they sink.
  "quote-old": { column: "quote_at", ascending: true, nullsFirst: false },
  activity: { column: "last_activity_at", ascending: false, nullsFirst: false },
  value: { column: "value_cents", ascending: false, nullsFirst: false },
  untouched: { column: "last_activity_at", ascending: true, nullsFirst: true },
};

/** P4: the extra dimensions a list can be narrowed by. Every one rides the URL. */
export type ListFilters = {
  /** Relationship state, or "delay_ended"; "" = every non-archived record. */
  state: string;
  tag: string;
  owner: string;
  temp: string;
  /** Derived lifecycle bucket: after_care · review · repaint_due. */
  life: string;
};
export const EMPTY_FILTERS: ListFilters = { state: "", tag: "", owner: "", temp: "", life: "" };
export const LIFECYCLE = [
  { key: "after_care", label: "After-care", hint: "job finished recently" },
  { key: "review", label: "Review & referral", hint: "finished a while ago, worth asking" },
  { key: "repaint_due", label: "Repaint due", hint: "by job type, from Settings" },
] as const;

export type ListQuery = { sort: SortKey; filter: GroupKey; q: string; page: number; pageSize: number; filters?: Partial<ListFilters> };

/** A saved view: a name for a set of URL params (Settings row `crm_views`, office-wide). */
export type SavedView = { key: string; name: string; params: Record<string, string> };
export const VIEWS_KEY = "crm_views";

export async function loadViews(db: SupabaseClient): Promise<SavedView[]> {
  const { data } = await db.from("settings").select("value").eq("key", VIEWS_KEY).maybeSingle();
  const raw = data?.value;
  return Array.isArray(raw) ? (raw as SavedView[]).filter((v) => v && typeof v.key === "string" && typeof v.name === "string") : [];
}

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
function applyFilter(qb: any, filter: GroupKey, q: string, f: Partial<ListFilters> = {}, t?: CrmThresholds, now: Date = new Date()): any {
  const lanes = lanesOf(filter);
  if (lanes) qb = qb.in("stage", lanes);
  if (filter === "trade") qb = qb.eq("account_type", "trade");
  const needle = q.trim().toLowerCase().replace(/[%_]/g, "");
  if (needle) qb = qb.ilike("search", `%${needle}%`);
  // P4: archived is hidden everywhere except search and its own filter.
  const nowIso = now.toISOString();
  if (f.state === "delay_ended") qb = qb.eq("relationship_state", "delayed").lte("state_until", nowIso);
  else if (f.state) qb = qb.eq("relationship_state", f.state);
  else if (!needle) qb = qb.neq("relationship_state", "archived");
  if (f.tag) qb = qb.contains("tags", [f.tag]);
  if (f.owner === "nobody") qb = qb.is("owner_id", null);
  else if (f.owner) qb = qb.eq("owner_id", f.owner);
  if (f.temp) qb = qb.eq("temperature", f.temp);
  if (f.life && t) {
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    if (f.life === "after_care") qb = qb.gte("last_job_completed_at", daysAgo(t.afterCareDays));
    if (f.life === "review") qb = qb.lt("last_job_completed_at", daysAgo(t.afterCareDays)).gte("last_job_completed_at", daysAgo(t.reviewWindowMonths * 30.4375));
    if (f.life === "repaint_due") qb = qb.lte("repaint_due_at", new Date(now.getTime() + 180 * 86_400_000).toISOString());
  }
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
    // A different shape from the page read, for the same fetch-memo reason as the record page.
    const { data } = await db.from("crm_account_facts").select(`${FACT_COLUMNS}, refreshed_at`).in("account_id", stale);
    const fresh = new Map(((data ?? []) as unknown as FactsRowRead[]).map((r) => [r.account_id, r]));
    return rows.map((r) => fresh.get(r.account_id) ?? r);
  } catch (e) {
    reportError(e, { where: "customers.freshen", bestEffort: true });
    return rows; // yesterday's card beats an error page
  }
}

/** Chip counts: one grouped query for lanes, one count for trade. */
export async function loadCounts(db: SupabaseClient): Promise<Record<GroupKey, number>> {
  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<GroupKey, number>;
  const [{ data: byStage }, { count: trade }] = await Promise.all([
    db.rpc("crm_board_counts"),
    db.from("crm_account_facts").select("account_id", { count: "exact", head: true }).eq("account_type", "trade").neq("relationship_state", "archived"),
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
  const thresholds = await loadCrmThresholds(db);
  const qb = applyFilter(db.from("crm_account_facts").select(FACT_COLUMNS, { count: "exact" }), query.filter, query.q, query.filters ?? {}, thresholds, now);
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
export async function loadBoard(db: SupabaseClient, filter: GroupKey, q: string, perLane = 25, now: Date = new Date(), f: Partial<ListFilters> = {}): Promise<BoardData> {
  await maybeRefreshFacts(db);
  const thresholds = await loadCrmThresholds(db);
  const lanes = lanesOf(filter) ?? LANES.map((l) => l.key);
  const [{ data: countRows }, tiles, sessions, ...laneReads] = await Promise.all([
    db.rpc("crm_board_counts"),
    db.rpc("crm_board_tiles", { p_stages: lanesOf(filter) }),
    !q.trim() && (filter === "all" || filter === "leads") ? loadSessionCards(db, 100) : Promise.resolve([]),
    ...lanes.map((lane) =>
      applyFilter(db.from("crm_account_facts").select(FACT_COLUMNS).eq("stage", lane), filter === "trade" ? "trade" : "all", q, f, thresholds, now)
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
