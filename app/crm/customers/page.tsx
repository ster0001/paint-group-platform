import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildBoard } from "@/lib/crm/board";
import BoardView from "./BoardView";
import { loadBoardInput, type CustomerInput } from "./data";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

const daysAgo = (s: string | null) => (s ? Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000) : null);
const shortDate = (s: string) => new Intl.DateTimeFormat("en-AU",
  { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(new Date(s));

const initials = (name: string) => {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

/**
 * The Customers tab (§4.3) — all of them, as a list or a board. Same
 * customers, same filters, two shapes; the filter rides the URL so it
 * survives the toggle.
 *
 * Sorting is browsing. Chasing is the queue's job — the copy at the foot says
 * so, because the one predictable failure is someone sorting by quote date,
 * working down the list, and believing they're covered (brief risk #4).
 */

/** ⚑7.4 — default sort. Quote date newest is the brief's suggestion. */
const SORTS = [
  { key: "quote-new", label: "Quote date — newest first", hint: "Chase while it's warm" },
  { key: "quote-old", label: "Quote date — oldest first", hint: "Rescue the ones going cold" },
  { key: "activity", label: "Last activity", hint: "Who you dealt with most recently" },
  { key: "value", label: "Value — highest first", hint: "Where the money is" },
  { key: "untouched", label: "Longest untouched", hint: "Who's been forgotten" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/** Groups per the workflow mockup, MINUS "Waiting on you" — those customers
 *  live in Today (§2.2). One fact, one home. */
const GROUPS = [
  { key: "all", label: "All" },
  { key: "leads", label: "Leads" },
  { key: "quoted", label: "Quote sent" },
  { key: "live", label: "Live work" },
  { key: "past", label: "Past customers" },
  { key: "trade", label: "Trade & B2B" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

const LANE_GROUP: Record<string, Exclude<GroupKey, "all" | "trade">> = {
  enquiry_unfinished: "leads",
  visit_booked: "leads",
  estimate_sent: "quoted",
  visit_done_no_reply: "quoted",
  negotiating: "quoted",
  job_on: "live",
  past_customer: "past",
};

type Row = {
  input: CustomerInput;
  group: Exclude<GroupKey, "all" | "trade"> | null;
  because: string;
  quoteAt: string | null;
  lastActivity: string | null;
};

function toRows(input: CustomerInput[]): Row[] {
  const board = buildBoard(input);
  const laneOf = new Map<string, string>();
  const becauseOf = new Map<string, string>();
  for (const lane of board.lanes) {
    for (const c of lane.cards) {
      laneOf.set(c.accountId, lane.key);
      becauseOf.set(c.accountId, c.because);
    }
  }
  return input.map((i) => {
    const est = i.facts.estimates;
    const quoteAt = est.reduce<string | null>((m, e) => {
      const at = e.sent_at ?? e.created_at;
      return !m || at > m ? at : m;
    }, null);
    const lastActivity = [
      ...i.facts.events.map((e) => e.occurred_at),
      ...est.map((e) => e.created_at),
    ].reduce<string | null>((m, at) => (!m || at > m ? at : m), null);
    const lane = laneOf.get(i.accountId) ?? null;
    return {
      input: i,
      group: lane ? LANE_GROUP[lane] ?? null : null,
      because: becauseOf.get(i.accountId) ?? "",
      quoteAt,
      lastActivity,
    };
  });
}

function sortRows(rows: Row[], sort: SortKey): Row[] {
  const at = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const by: Record<SortKey, (a: Row, b: Row) => number> = {
    "quote-new": (a, b) => at(b.quoteAt) - at(a.quoteAt),
    "quote-old": (a, b) => {
      // Oldest first — but "never quoted" is not "quoted long ago"; they sink.
      if (!a.quoteAt || !b.quoteAt) return a.quoteAt ? -1 : b.quoteAt ? 1 : 0;
      return at(a.quoteAt) - at(b.quoteAt);
    },
    activity: (a, b) => at(b.lastActivity) - at(a.lastActivity),
    value: (a, b) => (b.input.valueCents ?? 0) - (a.input.valueCents ?? 0),
    untouched: (a, b) => at(a.lastActivity) - at(b.lastActivity),
  };
  return [...rows].sort(by[sort]);
}

export default async function CustomersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; sort?: string; f?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "board" ? "board" : "list";
  const sort = (SORTS.some((s) => s.key === params.sort) ? params.sort : "quote-new") as SortKey;
  const filter = (GROUPS.some((g) => g.key === params.f) ? params.f : "all") as GroupKey;

  const supabase = await createClient();
  const input = await loadBoardInput(supabase);

  const inGroup = (r: Row, g: GroupKey) =>
    g === "all" ? true : g === "trade" ? r.input.trade : r.group === g;

  const allRows = toRows(input);
  const rows = sortRows(allRows.filter((r) => inGroup(r, filter)), sort);
  const filteredInput = new Set(rows.map((r) => r.input.accountId));

  const qs = (over: Partial<{ view: string; sort: string; f: string }>) => {
    const merged = { view, sort, f: filter, ...over };
    const parts = [];
    if (merged.view !== "list") parts.push(`view=${merged.view}`);
    if (merged.sort !== "quote-new") parts.push(`sort=${merged.sort}`);
    if (merged.f !== "all") parts.push(`f=${merged.f}`);
    return `/crm/customers${parts.length ? "?" + parts.join("&") : ""}`;
  };

  return (
    <>
      <h2>{input.length} customer{input.length === 1 ? "" : "s"}</h2>
      <p className="sub">Same list, two shapes. The board is a view, not a separate place.</p>

      <div className="bar">
        <div className="seg">
          <Link className={view === "list" ? "on" : ""} href={qs({ view: "list" })}>List</Link>
          <Link className={view === "board" ? "on" : ""} href={qs({ view: "board" })}>Board</Link>
        </div>
        {view === "list" && (
          <details className="sortwrap">
            <summary className="sortbtn">{SORTS.find((s) => s.key === sort)!.label.split("—")[0].trim()} ▾</summary>
            <div className="sortmenu">
              {SORTS.map((s) => (
                <Link key={s.key} className={`sopt ${s.key === sort ? "on" : ""}`} href={qs({ sort: s.key })}>
                  <span>{s.label}<small>{s.hint}</small></span>
                  {s.key === sort && <b className="tick">✓</b>}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="chips" style={{ margin: "12px 0 0" }}>
        {GROUPS.map((g) => {
          const n = g.key === "all" ? allRows.length : allRows.filter((r) => inGroup(r, g.key)).length;
          return (
            <Link key={g.key} className={`chip ${filter === g.key ? "on" : ""}`} href={qs({ f: g.key })}>
              {g.label}<span className="chipn mono">{n}</span>
            </Link>
          );
        })}
      </div>

      {view === "board" ? (
        <div style={{ marginTop: 14 }}>
          <BoardView input={input.filter((i) => filteredInput.has(i.accountId))} />
        </div>
      ) : rows.length === 0 ? (
        <p className="empty">Nobody matches that filter.</p>
      ) : (
        <div className="plist">
          {rows.map(({ input: a, quoteAt, lastActivity, because }) => {
            const quiet = daysAgo(lastActivity);
            return (
              <Link key={a.accountId} className="prow" href={`/crm/customers/${a.accountId}`}>
                <span className="av">{initials(a.name)}</span>
                <span className="pmain">
                  <span className="rn">
                    {a.facts.temperature && <i className={`dot ${a.facts.temperature}`} aria-hidden="true" />}
                    {a.name}
                  </span>
                  <span className="rs">{[a.meta, because].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="rr">
                  {quoteAt && (
                    <span className={`pill ${(daysAgo(quoteAt) ?? 0) > 7 ? "am" : "cy"}`}>Quoted {shortDate(quoteAt)}</span>
                  )}
                  <span className="rv mono">{a.valueCents ? money(a.valueCents) : "—"}</span>
                  <span className={`age ${quiet != null && quiet > 7 ? "bad" : ""}`}>
                    {quiet == null ? "no activity" : quiet === 0 ? "today" : `${quiet}d quiet`}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="note">
        <b>Sorting isn&rsquo;t a follow-up system.</b> This orders the list for browsing. The chasing
        itself is driven by rules — quoted and unopened, opened three times with no reply — and those
        land in <Link href="/crm/today" style={{ color: "var(--cyan)" }}>Today</Link> on their own.
      </div>
    </>
  );
}
