import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { LANES, type Lane } from "@/lib/workorder/stages";
import { TABLE_FILTERS, headlineParts, jobMoneyPage, matchCiRows, matchRows, type TableFilter } from "@/lib/invoicing/jobMoney";
import { ContractorsView } from "./payments/ContractorsView";
import { MaterialsView } from "./payments/MaterialsView";
import { melbourneToday } from "@/lib/invoicing/derive";
import { paymentsSettings } from "@/lib/invoicing/settings";
import { reportError } from "@/lib/monitoring/report";
import { PaymentsUiProvider } from "./payments/ActionsClient";
import ReadFailureNotice from "./ReadFailureNotice";
import { loadJobMoneyInput } from "./jobMoneyData";
import { BoardView, ChaseView, TableView } from "./payments/Views";
import { SearchBox, ShowPaid } from "./payments/Tools";
import { STAGE_NAME, longToday, money, pickerJobs, plural } from "./payments/labels";
import { JobPanel } from "./payments/JobPanel";
import { loadJobPanel } from "./payments/panelData";
import { ActivityFeed } from "./payments/ActivityView";
import { ExpensesView } from "./payments/ExpensesView";
import { loadExpenses } from "./payments/expensesData";
import { expenseTotals } from "@/lib/invoicing/expenses";
import { activityFeed, type ActivityLine } from "@/lib/invoicing/activity";
import "./payments/payments.css";

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
 *   job=<estimate id> opens the job panel over the view · jt=in|out its tab (Step 7)
 *
 * The switch-over (Step 8d): this IS /invoicing. /invoicing/payments and
 * /invoices redirect here; links written before it (`tab=pay`) still land.
 */
const TABS = ["cust", "con", "mat", "act"] as const;
const VIEWS = ["chase", "board", "table"] as const;
type Tab = (typeof TABS)[number];
type View = (typeof VIEWS)[number];
type Params = { tab?: string; view?: string; stage?: string; q?: string; paid?: string; f?: string; cby?: string; job?: string; jt?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE = "/invoicing";
const AGED_LABEL = ["Not overdue", "1–7 days", "8–14 days", "15–30 days", "Over 30 days"];
const AGED_COLOUR = ["var(--pri)", "var(--orange)", "var(--orange)", "var(--red)", "var(--red)"];
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  // Links written before the switch-over (emails, CRM items, bookmarks): the old
  // Payables tab is Contractors; the old Overdue / Paid filters are All jobs'.
  const legacyF = raw.f === "overdue" ? "over" : raw.f;
  const sp: Params = {
    ...raw,
    tab: raw.tab === "pay" ? "con" : raw.tab === "rec" ? undefined : raw.tab,
    f: legacyF,
    // The old page's Overdue and Paid filters had no view; they are All jobs filters here.
    view: raw.view ?? (raw.f === "overdue" || raw.f === "paid" ? "table" : undefined),
  };
  const tab: Tab = pick(sp.tab, TABS, "cust");
  const view: View = pick(sp.view, VIEWS, "chase");
  const stage: Lane | null = (LANES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as Lane) : null;
  const q = (sp.q ?? "").slice(0, 120);
  const showPaid = sp.paid === "1";
  const filter: TableFilter = pick(sp.f, TABLE_FILTERS, "all");
  const cby = pick(sp.cby, ["inv", "con"] as const, "inv");
  const jobId = UUID.test(sp.job ?? "") ? sp.job! : null;
  const jt = pick(sp.jt, ["in", "out"] as const, "in");

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
  const [{ input, failure }, settingsRes, expenses] = await Promise.all([
    loadJobMoneyInput(supabase, now),
    supabase.from("settings").select("key, value").eq("key", "invoicing"),
    // 8b: the expense queues — the Contractors card counts them; receipts are signed only when the tab is open.
    loadExpenses(supabase, tab === "con"),
  ]);
  const exp = expenseTotals(expenses.queues);
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
  // Every other link on the page drops job= — leaving the panel is any click outside it.
  const panel = jobId ? await loadJobPanel(supabase, page, jobId, now) : null;
  // Activity (§6.7): the newest invoice events, read only when the tab is open.
  let feed: ActivityLine[] = [];
  let activityProblem: string | null = null;
  if (tab === "act") {
    const { data, error } = await supabase.from("invoice_events").select("id, invoice_id, type, meta, created_at")
      .order("created_at", { ascending: false }).limit(150);
    if (error) { reportError(error, { where: "PaymentsPage.activity" }); activityProblem = "The activity could not be loaded — this is not an empty history. Reload the page."; }
    else feed = activityFeed(
      (data ?? []).map((e) => ({ id: e.id as string, invoiceId: e.invoice_id as string, type: e.type as string, meta: (e.meta ?? {}) as Record<string, unknown>, createdAt: e.created_at as string })),
      input.invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind, estimateId: i.estimateId })),
    );
  }
  const addressOf = new Map(page.rows.map((r) => [r.estimateId, r.address]));

  const ledger: Array<{ key: Tab; d: string; t: string; v: string | null; s: string; od: string | null }> = [
    { key: "cust", d: "Money in", t: "Customers owe us", v: money(customers.outstandingCents),
      s: `${plural(customers.outstandingCount, "sent invoice")} · ${money(customers.notSentCents)} not sent yet`,
      od: customers.overdueCents ? `${money(customers.overdueCents)} overdue` : null },
    { key: "con", d: "Money out", t: "Contractors", v: money(contractors.owingCents),
      s: `${contractors.toApproveCount} to approve · ${money(contractors.approvedToPayCents)} approved to pay${exp.toDecideCount ? ` · ${plural(exp.toDecideCount, "expense")} to decide` : ""}${exp.owedBackCount ? ` · ${money(exp.owedBackCents)} owed back` : ""}`,
      od: contractors.pastPayByCents ? `${money(contractors.pastPayByCents)} overdue` : null },
    { key: "mat", d: "Money out", t: "Materials", v: money(materials.openCents),
      s: `${materials.toCheckCount} to check · ${materials.toApproveCount} to approve · ${money(materials.toPayCents)} to pay${materials.noJobCount ? ` · ${materials.noJobCount} with no job` : ""}`, od: null },
    { key: "act", d: "", t: "Activity", v: null, s: `${money(activity.receivedFortnightCents)} received from customers in the last 14 days`, od: null },
  ];

  return (
    <div className="pm">
    {/* Inside .pm: the sheets and the toast the provider renders take the page's scoped styles. */}
    <PaymentsUiProvider settings={{ depositOptionsPct: settings.depositOptionsPct, notifyPaymentDefault: settings.notifyPaymentDefault, today: melbourneToday(now) }}
      jobs={pickerJobs(page.rows)}>
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
          <div className="aged" data-testid="aged-buckets">
            <h3>Aged receivables, sent invoices by days overdue</h3>
            <div className="bar">{customers.aged.map((b, i) => (b.pct ? <i key={i} style={{ width: `${b.pct}%`, background: AGED_COLOUR[i] }} /> : null))}</div>
            <div className="keys">{customers.aged.map((b, i) => <div key={i}><b>{money(b.cents)}</b>{AGED_LABEL[i]}</div>)}</div>
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
          {expenses.failure ? <ReadFailureNotice failure={expenses.failure} /> : <ExpensesView q={expenses.queues} />}
        </section>
        <section hidden={tab !== "mat"} data-testid="pm-materials"><MaterialsView m={page.materials} /></section>
        <section hidden={tab !== "act"} data-testid="pm-activity">
          {activityProblem ? <div className="note">{activityProblem}</div> : <ActivityFeed lines={feed} addressOf={addressOf} />}
        </section>
      </main>
      {panel ? <>
        <Link className="scrim on" href={href({})} aria-label="Close the job" scroll={false} />
        <aside className="drawer on" role="dialog" aria-modal="true" aria-label={panel.row.address} data-testid="pm-panel">
          <JobPanel d={panel} tab={jt} tabHref={(t) => href({ job: panel.row.estimateId, jt: t === "in" ? null : t })} closeHref={href({})}
            closeLabel="Payments" today={melbourneToday(now)} termsDays={settings.paymentTermsDays} />
        </aside>
      </> : null}
    </PaymentsUiProvider>
    </div>
  );
}
