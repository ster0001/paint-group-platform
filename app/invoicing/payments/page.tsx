import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { LANES, type Lane } from "@/lib/workorder/stages";
import { TABLE_FILTERS, headlineParts, jobMoneyPage, matchCiRows, matchRows, type TableFilter } from "@/lib/invoicing/jobMoney";
import { ContractorsView } from "./ContractorsView";
import { melbourneToday } from "@/lib/invoicing/derive";
import { paymentsSettings } from "@/lib/invoicing/settings";
import { reportError } from "@/lib/monitoring/report";
import { PaymentsUiProvider } from "./ActionsClient";
import ReadFailureNotice from "../ReadFailureNotice";
import { loadJobMoneyInput } from "../jobMoneyData";
import { BoardView, ChaseView, TableView } from "./Views";
import { SearchBox, ShowPaid } from "./Tools";
import { STAGE_NAME, longToday, money, plural } from "./labels";
import "./payments.css";

export const dynamic = "force-dynamic";
/** One-press "✓ Paid" sends its receipt after the Undo window (⚑P2), behind the response. */
export const maxDuration = 60;

/**
 * Payments — one page for customers, contractors and materials (payments-merge
 * brief §4.2, Step 2), built to design/reference/payments-merged-v3-mockup.html.
 * Every figure is `jobMoneyPage` (lib/invoicing/jobMoney.ts); this file chooses
 * what to show and formats it. Staff only — the invoicing layout gates it.
 *
 * Selection lives in the URL so any view can be shared:
 *   tab=cust|con|mat|act · view=chase|board|table · stage=<lane> · q=<search>
 *   paid=1 (Show paid jobs) · f=all|over|dep|fin|paid (All jobs filter)
 *
 * Lives at /invoicing/payments on feat/payments-merge; Step 8 makes it
 * /invoicing (Tom, 13 Oct: one switch-over).
 */
const TABS = ["cust", "con", "mat", "act"] as const;
const VIEWS = ["chase", "board", "table"] as const;
type Tab = (typeof TABS)[number];
type View = (typeof VIEWS)[number];
type Params = { tab?: string; view?: string; stage?: string; q?: string; paid?: string; f?: string; cby?: string };

const BASE = "/invoicing/payments";
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab: Tab = pick(sp.tab, TABS, "cust");
  const view: View = pick(sp.view, VIEWS, "chase");
  const stage: Lane | null = (LANES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as Lane) : null;
  const q = (sp.q ?? "").slice(0, 120);
  const showPaid = sp.paid === "1";
  const filter: TableFilter = pick(sp.f, TABLE_FILTERS, "all");
  const cby = pick(sp.cby, ["inv", "con"] as const, "inv");

  const current: Record<string, string | null> = {
    tab: tab === "cust" ? null : tab, view: view === "chase" ? null : view, stage, q: q || null, paid: showPaid ? "1" : null, f: filter === "all" ? null : filter,
    cby: cby === "inv" ? null : cby,
  };
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${BASE}?${s}` : BASE;
  };

  const now = new Date();
  const supabase = await createClient();
  const [{ input, failure }, settingsRes] = await Promise.all([
    loadJobMoneyInput(supabase, now),
    supabase.from("settings").select("key, value").eq("key", "invoicing"),
  ]);
  if (settingsRes.error) reportError(settingsRes.error, { where: "PaymentsPage.settings", bestEffort: true });
  const settings = paymentsSettings((settingsRes.data ?? []) as { key: string; value: unknown }[]);
  if (!input) {
    const reason = failure ?? { headline: "The payments could not be loaded — this is not an empty ledger.", detail: "Reload the page; if it keeps happening, the error has been reported." };
    return <div className="pm"><main className="pm-wrap"><ReadFailureNotice failure={reason} /></main></div>;
  }
  const page = jobMoneyPage({ ...input, paymentTermsDays: settings.paymentTermsDays });
  const { customers, contractors, materials, activity } = page.blocks;
  const rows = matchRows(page.rows, { q, lane: stage });
  const notPaid = rows.filter((r) => r.section !== "paid_in_full");

  const ledger: Array<{ key: Tab; d: string; t: string; v: string | null; s: string; od: string | null }> = [
    { key: "cust", d: "Money in", t: "Customers owe us", v: money(customers.outstandingCents),
      s: `${plural(customers.outstandingCount, "sent invoice")} · ${money(customers.notSentCents)} not sent yet`,
      od: customers.overdueCents ? `${money(customers.overdueCents)} overdue` : null },
    { key: "con", d: "Money out", t: "Contractors", v: money(contractors.owingCents),
      s: `${contractors.toApproveCount} to approve · ${money(contractors.approvedToPayCents)} approved to pay`,
      od: contractors.pastPayByCents ? `${money(contractors.pastPayByCents)} overdue` : null },
    { key: "mat", d: "Money out", t: "Materials", v: money(materials.openCents),
      s: `${materials.toCheckCount} to check · ${materials.toApproveCount} to approve · ${money(materials.toPayCents)} to pay`, od: null },
    { key: "act", d: "", t: "Activity", v: null, s: `${money(activity.receivedFortnightCents)} received from customers in the last 14 days`, od: null },
  ];

  return (
    <div className="pm">
    {/* Inside .pm: the sheets and the toast the provider renders take the page's scoped styles. */}
    <PaymentsUiProvider settings={{ depositOptionsPct: settings.depositOptionsPct, notifyPaymentDefault: settings.notifyPaymentDefault, today: melbourneToday(now) }}>
      <main className="pm-wrap">
        <section className="lead">
          <h1 data-testid="pm-headline">
            {headlineParts(page.headline, money).map((p, i) => p.tone ? <span key={i} className={p.tone}>{p.text}</span> : <span key={i}>{p.text}</span>)}
          </h1>
          <p>This line is written from the figures below each time the page loads. Showing {longToday(now)}.</p>
        </section>

        <nav className="ledger" aria-label="Where the money is" data-testid="pm-ledger">
          {ledger.map((l) => (
            <Link key={l.key} className={`led${tab === l.key ? " on" : ""}`} aria-current={tab === l.key ? "page" : undefined}
              href={href({ tab: l.key === "cust" ? null : l.key })}>
              <span className="d">{l.d || " "}</span><span className="t">{l.t}</span>
              {l.v ? <span className="v">{l.v}</span> : null}<span className="s">{l.s}</span>
              {l.od ? <span className="od">{l.od}</span> : null}
            </Link>
          ))}
        </nav>

        <section hidden={tab !== "cust"}>
          <div className="strip-h">
            <h2>Money to collect from customers, by job stage</h2>
            {stage ? <Link href={href({ stage: null })}>Show all stages</Link> : null}
          </div>
          <div className="strip" data-testid="pm-strip">
            {page.strip.map((c) => (
              <Link key={c.lane} className={`stg ${c.tone}${stage === c.lane ? " on" : ""}`} aria-current={stage === c.lane ? "true" : undefined}
                href={href({ stage: stage === c.lane ? null : c.lane })}>
                <span className="bar" /><span className="n">{STAGE_NAME[c.lane]}</span><span className="c">{plural(c.jobs, "job")}</span>
                <span className={`v${c.collectableCents ? "" : " zero"}`}>{money(c.collectableCents)}</span>
                {c.overdueCents ? <span className="x">{money(c.overdueCents)} overdue</span> : null}
              </Link>
            ))}
          </div>
          <div className="tools">
            <div className="views">
              {VIEWS.map((v) => (
                <Link key={v} className={view === v ? "on" : undefined} href={href({ view: v === "chase" ? null : v })}>
                  {v === "chase" ? "To chase" : v === "board" ? "By job stage" : "All jobs"}
                </Link>
              ))}
            </div>
            {tab === "cust" ? <Suspense fallback={null}><SearchBox initial={q} /></Suspense> : null}
            {view !== "chase" ? <Suspense fallback={null}><ShowPaid on={showPaid} /></Suspense> : null}
          </div>
          <div>
            {view === "chase" ? <ChaseView rows={notPaid} hiddenDrafts={page.hiddenDraftCount} expandOffer={!!(q || stage)} href={href} /> : null}
            {view === "board" ? <BoardView rows={showPaid ? rows : notPaid} /> : null}
            {view === "table" ? <TableView rows={rows} filter={filter} showPaid={showPaid} href={href} /> : null}
          </div>
        </section>

        <section hidden={tab !== "con"} data-testid="pm-contractors">
          <div className="tools">
            <div className="views">
              <Link className={cby === "inv" ? "on" : undefined} href={href({ cby: null })}>By invoice</Link>
              <Link className={cby === "con" ? "on" : undefined} href={href({ cby: "con" })}>By contractor</Link>
            </div>
            {tab === "con" ? <Suspense fallback={null}><SearchBox initial={q} label="Search contractor or address" /></Suspense> : null}
          </div>
          <ContractorsView rows={matchCiRows(page.contractors, q)} by={cby} />
        </section>
        <section hidden={tab !== "mat"}><div className="empty">Supplier invoices and receipts move here in Step 6. Until then they stay on the current Payables tab.</div></section>
        <section hidden={tab !== "act"}><div className="empty">Activity moves here in Step 8, with repeated &ldquo;Invoice viewed by customer&rdquo; lines folded into one.</div></section>
      </main>
    </PaymentsUiProvider>
    </div>
  );
}
