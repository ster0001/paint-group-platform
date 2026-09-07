import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import BoardView from "./BoardView";
import QuickAdd from "./QuickAdd";
import { GROUPS, LANE_GROUP, SORTS, loadBoard, loadCustomerPage, type FactsCard, type GroupKey, type SortKey } from "./data";
import type { LaneKey } from "@/lib/crm/stage";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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
 * customers, same filters, two shapes; the filter, the search and the page
 * ride the URL so they survive the toggle and the back button.
 *
 * CRM v2 P1: reads crm_account_facts through SQL — search, filter, sort, page
 * and count. The heading is a count query. Sorting is browsing. Chasing is
 * the queue's job — the copy at the foot says so, because the one predictable
 * failure is someone sorting by quote date, working down the list, and
 * believing they're covered (brief risk #4).
 */
export default async function CustomersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; sort?: string; f?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "board" ? "board" : "list";
  const sort = (SORTS.some((s) => s.key === params.sort) ? params.sort : "quote-new") as SortKey;
  const filter = (GROUPS.some((g) => g.key === params.f) ? params.f : "all") as GroupKey;
  const q = (params.q ?? "").slice(0, 80);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const supabase = await createClient();

  const qs = (over: Partial<{ view: string; sort: string; f: string; q: string; page: number }>) => {
    const merged = { view, sort, f: filter, q, page, ...over };
    const parts = [];
    if (merged.view !== "list") parts.push(`view=${merged.view}`);
    if (merged.sort !== "quote-new") parts.push(`sort=${merged.sort}`);
    if (merged.f !== "all") parts.push(`f=${merged.f}`);
    if (merged.q) parts.push(`q=${encodeURIComponent(merged.q)}`);
    if (merged.page > 1) parts.push(`page=${merged.page}`);
    return `/crm/customers${parts.length ? "?" + parts.join("&") : ""}`;
  };

  const board = view === "board" ? await loadBoard(supabase, filter, q) : null;
  const list = view === "list" ? await loadCustomerPage(supabase, { sort, filter, q, page, pageSize: PAGE_SIZE }) : null;
  const counts: Record<GroupKey, number> | null = list?.counts ?? (board
    ? (Object.fromEntries(GROUPS.map((g) => [g.key,
        g.key === "all" ? board.lanes.reduce((s, l) => s + l.count, 0)
          : g.key === "trade" ? 0
          : board.lanes.filter((l) => LANE_GROUP[l.key] === g.key).reduce((s, l) => s + l.count, 0)])) as Record<GroupKey, number>)
    : null);
  const total = counts?.all ?? 0;

  const pageRows: FactsCard[] = list ? [...list.sessions, ...list.rows] : [];
  const lastPage = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;
  const firstOnPage = list ? (list.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1) : 0;
  const lastOnPage = list ? Math.min(page * PAGE_SIZE, list.total) : 0;

  return (
    <>
      <h2>{total.toLocaleString("en-AU")} customer{total === 1 ? "" : "s"}</h2>
      <p className="sub">Same list, two shapes. The board is a view, not a separate place.</p>

      <div className="bar">
        <div className="seg">
          <Link className={view === "list" ? "on" : ""} href={qs({ view: "list", page: 1 })}>List</Link>
          <Link className={view === "board" ? "on" : ""} href={qs({ view: "board", page: 1 })}>Board</Link>
        </div>
        <form className="csearch" action="/crm/customers" method="get" role="search">
          {view !== "list" && <input type="hidden" name="view" value={view} />}
          {sort !== "quote-new" && <input type="hidden" name="sort" value={sort} />}
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <input className="field" type="search" name="q" defaultValue={q} placeholder="Name, phone, email, address" aria-label="Search customers" />
          {q && <Link className="clearq" href={qs({ q: "", page: 1 })} aria-label="Clear search">×</Link>}
        </form>
        <QuickAdd />
        {view === "list" && (
          <details className="sortwrap">
            <summary className="sortbtn">{SORTS.find((s) => s.key === sort)!.label.split("—")[0].trim()} ▾</summary>
            <div className="sortmenu">
              {SORTS.map((s) => (
                <Link key={s.key} className={`sopt ${s.key === sort ? "on" : ""}`} href={qs({ sort: s.key, page: 1 })}>
                  <span>{s.label}<small>{s.hint}</small></span>
                  {s.key === sort && <b className="tick">✓</b>}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="chips" style={{ margin: "12px 0 0" }}>
        {GROUPS.map((g) => (
          <Link key={g.key} className={`chip ${filter === g.key ? "on" : ""}`} href={qs({ f: g.key, page: 1 })}>
            {g.label}<span className="chipn mono">{counts?.[g.key] ?? 0}</span>
          </Link>
        ))}
      </div>

      {board ? (
        <div style={{ marginTop: 14 }}>
          <BoardView board={board} moreHref={(lane) => qs({ view: "list", f: LANE_GROUP[lane as LaneKey], page: 1 })} />
        </div>
      ) : !list || pageRows.length === 0 ? (
        <p className="empty">{q ? `Nobody matches “${q}”.` : "Nobody matches that filter."}</p>
      ) : (
        <>
          <div className="plist">
            {pageRows.map((a) => {
              const quiet = daysAgo(a.lastActivityAt);
              return (
                <Link key={a.accountId} className="prow" href={a.href}>
                  <span className="av">{initials(a.name)}</span>
                  <span className="pmain">
                    <span className="rn">
                      {a.temperature && <i className={`dot ${a.temperature}`} aria-hidden="true" />}
                      {a.name}
                    </span>
                    <span className="rs">{[a.meta, a.because].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="rr">
                    {a.quoteAt && (
                      <span className={`pill ${(daysAgo(a.quoteAt) ?? 0) > 7 ? "am" : "cy"}`}>Quoted {shortDate(a.quoteAt)}</span>
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
          <div className="pager">
            <span className="mono">
              {list.total === 0 ? "0" : `${firstOnPage}–${lastOnPage}`} of {list.total.toLocaleString("en-AU")}
              {list.sessions.length > 0 && ` · plus ${list.sessions.length} open session${list.sessions.length === 1 ? "" : "s"}`}
            </span>
            <span className="pagerlinks">
              {page > 1 ? <Link href={qs({ page: page - 1 })}>← Back</Link> : <span className="off">← Back</span>}
              <span className="mono">{page} / {lastPage}</span>
              {page < lastPage ? <Link href={qs({ page: page + 1 })}>Next →</Link> : <span className="off">Next →</span>}
            </span>
          </div>
        </>
      )}

      <div className="note">
        <b>Sorting isn&rsquo;t a follow-up system.</b> This orders the list for browsing. The chasing
        itself is driven by rules — quoted and unopened, opened three times with no reply, a quote that lapsed — and those
        land in <Link href="/crm/today" style={{ color: "var(--cyan)" }}>Today</Link> on their own.
      </div>
    </>
  );
}
