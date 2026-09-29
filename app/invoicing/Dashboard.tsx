"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { DashboardTiles, InvoiceKind, PayablesTiles } from "@/lib/invoicing/derive";
import type { CiTone } from "@/lib/invoicing/contractorInvoiceTone";
import type { ReadFailure } from "@/lib/invoicing/loadFailure";
import ReadFailureNotice from "./ReadFailureNotice";
import { fmt0, fmt2 } from "./format";
import { approveContractorInvoiceAction, markContractorInvoicePaidAction } from "./actions";
import PayablesCosts, {
  type AccuracyProp, type CostPayableRowProp, type ExpenseClaimProp, type IntakeCardProp,
  type JobPickProp, type PreapprovalProp, type ReimbursementProp, type UnmatchedMaterialProp,
} from "./PayablesCosts";

/**
 * §7.2 client shell — tabs, filter chips (mirrored into query params so a
 * filtered view is shareable), rows, aged bar. Renders only: every number
 * arrives computed from lib/invoicing via the server page.
 */

export type RowProp = {
  invoiceId: string;
  estimateId: string;
  job: string;
  /** The customer's name as accepted — the search box matches on it (Tom, 17 Sep). */
  customer: string;
  ref: string;
  filter: "overdue" | "awaiting" | "partial" | "draft" | "paid" | "other";
  /** Tom, 29 Sep: the invoice's milestone (deposit / progress / final …) so the page can filter by it. */
  kind: InvoiceKind;
  /** Money still collectable: an open status with a balance above zero (lib/invoicing/derive). */
  outstanding: boolean;
  /** Days until due (negative = overdue), null when the invoice has no due date or is settled. */
  dueIn: number | null;
  ageLabel: string;
  ageTone: "clay" | "amber" | "cyan" | "emerald" | "";
  amtCents: number;
  dots: ("paid" | "open" | "none")[];
  overdue: boolean;
  draft: boolean;
  sortKey: number;
};

export type ActivityProp = { tone: string; title: string; meta: string };

export type PayableRowProp = {
  ciId: string;
  estimateId: string | null;
  company: string;
  ref: string; // "CI-0031 · WO-1234 · job address"
  status: "draft" | "submitted" | "approved" | "paid";
  amtCents: number;
  dueLabel: string;
  /** lib/invoicing/contractorInvoiceTone — decided on the server, rendered as a class (Tom, 20 Sep). */
  tone: CiTone;
  toneClass: string;
  /** "overdue 3 d" once an approved invoice is past its terms; null otherwise. */
  overdueLabel: string | null;
  rcti: boolean;
  /** The job's stage from PC control — the Payables row carries it (Tom, 24 Aug). */
  stageLabel: string;
  hasPdf: boolean;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outstanding", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "awaiting", label: "Awaiting" },
  { key: "partial", label: "Partially paid" },
  { key: "draft", label: "Draft" },
  { key: "paid", label: "Paid" },
];

/**
 * Tom, 29 Sep: "a view for final payments outstanding and more filters at the
 * top of the page". Three rows of chips, each mirrored into the URL so a view
 * is a link: status (above), milestone (`k`) and due window (`d`). A VIEW is a
 * named combination of the three — one press sets all of them.
 */
const KINDS: { key: string; label: string; kinds: InvoiceKind[] }[] = [
  { key: "all", label: "Any milestone", kinds: [] },
  { key: "deposit", label: "Deposit", kinds: ["deposit"] },
  { key: "progress", label: "Progress", kinds: ["progress"] },
  { key: "final", label: "Final", kinds: ["final"] },
  { key: "variation", label: "Variation", kinds: ["variation"] },
  { key: "standalone", label: "Standalone", kinds: ["standalone"] },
];
const DUE: { key: string; label: string; test: (dueIn: number | null) => boolean }[] = [
  { key: "any", label: "Any time", test: () => true },
  { key: "week", label: "Due within 7 days", test: (d) => d !== null && d >= 0 && d <= 7 },
  { key: "month", label: "Due within 30 days", test: (d) => d !== null && d >= 0 && d <= 30 },
  { key: "over7", label: "Overdue 7+ days", test: (d) => d !== null && d <= -7 },
  { key: "over30", label: "Overdue 30+ days", test: (d) => d !== null && d <= -30 },
];
export const VIEWS: { key: string; label: string; filter: string; kind: string; due: string }[] = [
  { key: "final-outstanding", label: "Final payments outstanding", filter: "outstanding", kind: "final", due: "any" },
  { key: "deposits-outstanding", label: "Deposits outstanding", filter: "outstanding", kind: "deposit", due: "any" },
  { key: "progress-outstanding", label: "Progress payments outstanding", filter: "outstanding", kind: "progress", due: "any" },
  { key: "overdue-30", label: "Overdue 30+ days", filter: "overdue", kind: "all", due: "over30" },
];
const rowMatchesFilter = (r: RowProp, f: string) => f === "all" ? true : f === "outstanding" ? r.outstanding : r.filter === f;

const BUCKET_LABELS = ["current", "1–7 d", "8–14 d", "15–30 d", "30+ d"];
const BUCKET_COLOURS = ["var(--paint)", "var(--clay)", "var(--clay)", "var(--clay)", "var(--clay)"];

export default function Dashboard({
  tiles, buckets, rows, activity, initialFilter, initialTab,
  payables = null, materialsToMatchCount = 0, payableRows = [], costs = null, loadError = null, costsError = null,
  initialKind = "all", initialDue = "any",
}: {
  tiles: DashboardTiles;
  buckets: [number, number, number, number, number];
  rows: RowProp[];
  activity: ActivityProp[];
  /** Set when a read behind this screen failed — never present its figures as fact then. */
  loadError?: ReadFailure | null;
  /** The same, for the money-OUT lists on Payables — tolerant, but not silent. */
  costsError?: ReadFailure | null;
  initialFilter: string;
  initialTab: string;
  /** Milestone (`k`) and due-window (`d`) chips, from the URL. */
  initialKind?: string;
  initialDue?: string;
  payables?: PayablesTiles | null;
  /** Supplier invoices with no job yet — `materialsToMatch(rows).length`, the same function as the home tile. */
  materialsToMatchCount?: number;
  payableRows?: PayableRowProp[];
  costs?: {
    cards: IntakeCardProp[];
    jobs: JobPickProp[];
    unmatched: UnmatchedMaterialProp[];
    costRows: CostPayableRowProp[];
    accuracy: AccuracyProp;
    expenseClaims?: ExpenseClaimProp[];
    preapprovals?: PreapprovalProp[];
    /** Employed painters (S5): approved personal-card claims owed back. */
    reimbursements?: ReimbursementProp[];
  } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab === "pay" || initialTab === "act" ? initialTab : "recv");
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "all");
  const [kind, setKind] = useState(KINDS.some((k) => k.key === initialKind) ? initialKind : "all");
  const [due, setDue] = useState(DUE.some((d) => d.key === initialDue) ? initialDue : "any");
  // Tom, 17 Sep: search the receivables by customer name or property address.
  const [search, setSearch] = useState("");
  const [payMessage, setPayMessage] = useState<string | null>(null);
  const [payBusy, startPay] = useTransition();

  function approveCi(ciId: string) {
    setPayMessage(null);
    startPay(async () => {
      const result = await approveContractorInvoiceAction({ contractorInvoiceId: ciId });
      setPayMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  function markCiPaid(ciId: string) {
    // Recording, not moving, money — the reference and the DATE it left the
    // bank, typed here (Tom, 24 Aug: record the payment date).
    const reference = window.prompt("Bank reference for this payment (shown on the remittance):");
    if (reference === null) return;
    const today = new Date().toISOString().slice(0, 10);
    const paidOn = window.prompt("Payment date (yyyy-mm-dd):", today);
    if (paidOn === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn.trim())) {
      setPayMessage("That date needs to be yyyy-mm-dd — nothing was recorded.");
      return;
    }
    setPayMessage(null);
    startPay(async () => {
      const result = await markContractorInvoicePaidAction({
        contractorInvoiceId: ciId, reference, paidOn: paidOn.trim(),
      });
      setPayMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  const setUrl = (nextTab: string, nextFilter: string, nextKind = kind, nextDue = due) => {
    const q = new URLSearchParams();
    if (nextTab !== "recv") q.set("tab", nextTab);
    if (nextFilter !== "all") q.set("f", nextFilter);
    if (nextKind !== "all") q.set("k", nextKind);
    if (nextDue !== "any") q.set("d", nextDue);
    router.replace(`/invoicing${q.size ? `?${q}` : ""}`, { scroll: false });
  };
  const applyView = (v: (typeof VIEWS)[number]) => {
    setFilter(v.filter); setKind(v.kind); setDue(v.due);
    setUrl(tab, v.filter, v.kind, v.due);
  };
  const activeView = VIEWS.find((v) => v.filter === filter && v.kind === kind && v.due === due)?.key ?? null;

  // Each chip's count is taken with the OTHER two rows applied, so a number
  // on a chip is what pressing it will show.
  const kindDef = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const dueDef = DUE.find((d) => d.key === due) ?? DUE[0];
  const byKind = (r: RowProp) => kindDef.kinds.length === 0 || kindDef.kinds.includes(r.kind);
  const byDue = (r: RowProp) => dueDef.test(r.dueIn);
  const counts: Record<string, number> = {};
  for (const f of FILTERS) counts[f.key] = rows.filter((r) => rowMatchesFilter(r, f.key) && byKind(r) && byDue(r)).length;
  const kindCounts: Record<string, number> = {};
  for (const k of KINDS) kindCounts[k.key] = rows.filter((r) => rowMatchesFilter(r, filter) && (k.kinds.length === 0 || k.kinds.includes(r.kind)) && byDue(r)).length;
  const dueCounts: Record<string, number> = {};
  for (const d of DUE) dueCounts[d.key] = rows.filter((r) => rowMatchesFilter(r, filter) && byKind(r) && d.test(r.dueIn)).length;

  const needle = search.trim().toLowerCase();
  const visible = rows.filter((r) => rowMatchesFilter(r, filter) && byKind(r) && byDue(r))
    .filter((r) => !needle || `${r.customer} ${r.job} ${r.ref}`.toLowerCase().includes(needle));
  // The sum over what is showing — the figure a "final payments outstanding"
  // view exists to answer. Balances only: a paid row carries 0.
  const visibleCents = visible.reduce((a, r) => a + r.amtCents, 0);
  const filtered = filter !== "all" || kind !== "all" || due !== "any";
  const bucketTotal = buckets.reduce((a, b) => a + b, 0);
  const sparkMax = Math.max(...tiles.collectedSpark, 1);

  return (
    <div className="wrap">
      <header>
        <div className="crumb"><Link href="/pc"><span className="chev">‹</span> PC Command</Link></div>
        <h1>Payments</h1>
        <div className="sub">All jobs · receivables &amp; payables · <Link href="/invoices">invoice list →</Link></div>
      </header>

      {loadError && <ReadFailureNotice failure={loadError} />}

      <div className="tiles">
        <div className="tile"><div className="k">Outstanding</div>
          <div className="v" data-testid="tile-outstanding">{fmt0(tiles.outstandingCents)}</div>
          <div className="m">{tiles.outstandingCount} invoice{tiles.outstandingCount === 1 ? "" : "s"} · {tiles.outstandingJobs} job{tiles.outstandingJobs === 1 ? "" : "s"}</div>
        </div>
        <div className="tile overdue"><div className="k">Overdue</div>
          <div className="v" data-testid="tile-overdue">{fmt0(tiles.overdueCents)}</div>
          <div className="m">{tiles.overdueCount ? `${tiles.overdueCount} invoice${tiles.overdueCount === 1 ? "" : "s"} · oldest ${tiles.overdueOldestDays} days` : "nothing overdue"}</div>
        </div>
        <div className="tile week"><div className="k">Due this week</div>
          <div className="v">{fmt0(tiles.dueThisWeekCents)}</div>
          <div className="m">{tiles.dueThisWeekCount} invoice{tiles.dueThisWeekCount === 1 ? "" : "s"}</div>
        </div>
        <div className="tile collected"><div className="k">Collected · 14 days</div>
          <div className="v" data-testid="tile-collected">{fmt0(tiles.collectedFortnightCents)}</div>
          <div className="spark" aria-hidden="true">
            {tiles.collectedSpark.slice(-7).map((c, i) => (
              <i key={i} style={{ height: `${Math.max(2, Math.round((c / sparkMax) * 20))}px` }} />
            ))}
          </div>
        </div>
      </div>

      <nav className="tabs">
        <button className={tab === "recv" ? "on" : undefined} onClick={() => { setTab("recv"); setUrl("recv", filter); }}>Receivables</button>
        <button className={tab === "pay" ? "on" : undefined} onClick={() => { setTab("pay"); setUrl("pay", filter); }}>Payables</button>
        <button className={tab === "act" ? "on" : undefined} onClick={() => { setTab("act"); setUrl("act", filter); }}>Activity</button>
      </nav>

      {/* ================= RECEIVABLES ================= */}
      <section className={`tab ${tab === "recv" ? "on" : ""}`}>
        <div className="search" role="search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or address"
            aria-label="Search invoices by customer name or property address"
            data-testid="payments-search-input"
          />
          {search && <button type="button" onClick={() => setSearch("")} data-testid="payments-search-clear">Clear</button>}
        </div>
        <div className="filters views" data-testid="payments-views" aria-label="Views">
          <span className="fl">Views</span>
          {VIEWS.map((v) => (
            <button key={v.key} className={`f ${activeView === v.key ? "on" : ""}`} data-testid={`payments-view-${v.key}`}
              onClick={() => applyView(v)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="filters" data-testid="payments-filters" aria-label="Status">
          <span className="fl">Status</span>
          {FILTERS.map((fx) => (
            <button key={fx.key} className={`f ${filter === fx.key ? "on" : ""}`} data-testid={`payments-filter-${fx.key}`}
              onClick={() => { setFilter(fx.key); setUrl(tab, fx.key); }}>
              {fx.label}<b>{counts[fx.key] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="filters" data-testid="payments-kinds" aria-label="Milestone">
          <span className="fl">Milestone</span>
          {KINDS.map((k) => (
            <button key={k.key} className={`f ${kind === k.key ? "on" : ""}`} data-testid={`payments-kind-${k.key}`}
              onClick={() => { setKind(k.key); setUrl(tab, filter, k.key, due); }}>
              {k.label}<b>{kindCounts[k.key] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="filters" data-testid="payments-due" aria-label="Due">
          <span className="fl">Due</span>
          {DUE.map((d) => (
            <button key={d.key} className={`f ${due === d.key ? "on" : ""}`} data-testid={`payments-due-${d.key}`}
              onClick={() => { setDue(d.key); setUrl(tab, filter, kind, d.key); }}>
              {d.label}<b>{dueCounts[d.key] ?? 0}</b>
            </button>
          ))}
        </div>
        <div className="sumline" data-testid="payments-sum">
          <span>{visible.length} invoice{visible.length === 1 ? "" : "s"}{filtered ? " on this view" : ""}{needle ? ` matching “${search.trim()}”` : ""}</span>
          <b data-testid="payments-sum-cents">{fmt0(visibleCents)}</b>
          {filtered && (
            <button type="button" className="mini" data-testid="payments-clear-filters"
              onClick={() => { setFilter("all"); setKind("all"); setDue("any"); setUrl(tab, "all", "all", "any"); }}>
              Clear filters
            </button>
          )}
        </div>

        <div className="rows" data-testid="receivable-rows">
          {visible.map((r) => (
            <div key={r.invoiceId}
              className={`r ${r.overdue ? "overdue" : ""} ${r.draft ? "draft" : ""}`}
              onClick={() => router.push(`/invoicing/inv/${r.invoiceId}`)}
              role="link" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") router.push(`/invoicing/inv/${r.invoiceId}`); }}>
              <div className="body">
                <div className="job">
                  <Link href={`/invoicing/job/${r.estimateId}`} onClick={(e) => e.stopPropagation()}>{r.job}</Link>
                  {r.customer && <span className="who"> · {r.customer}</span>}
                </div>
                <div className="ref">{r.ref}</div>
                <div className={`age ${r.ageTone}`}>{r.ageLabel}</div>
              </div>
              <div className="right">
                <div className="amt">{fmt0(r.amtCents)}</div>
                <div className="dots">{r.dots.map((d, i) => <span key={i} className={`d ${d === "paid" ? "paid" : d === "open" ? "open" : ""}`} />)}</div>
              </div>
              <span className="go">›</span>
            </div>
          ))}
          {visible.length === 0 && (
            <div className="card"><div className="hint">{loadError
              ? "Nothing can be listed until the read above succeeds — this is not an empty ledger."
              : needle
                ? `No invoice matches “${search.trim()}” on this view.`
                : filtered
                  ? "No invoice matches these filters — clear one, or pick another view."
                  : "Nothing here — accept an estimate and the deposit draft appears on its own."}</div></div>
          )}
        </div>

        <div className="card">
          <h3>Aged receivables</h3>
          <div className="agebar">
            {bucketTotal > 0 && buckets.map((b, i) => (
              b > 0 ? <i key={i} style={{ width: `${(b / bucketTotal) * 100}%`, background: BUCKET_COLOURS[i] }} /> : null
            ))}
          </div>
          <div className="agekeys" data-testid="aged-buckets">
            {buckets.map((b, i) => (
              <div key={i}><b>{fmt0(b)}</b>{BUCKET_LABELS[i]}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= PAYABLES ================= */}
      <section className={`tab ${tab === "pay" ? "on" : ""}`}>
        {costsError && <ReadFailureNotice failure={costsError} />}
        {payables && (
          <div className="ptiles">
            <div className="tile"><div className="k">To approve</div>
              <div className="v" data-testid="tile-to-approve">{fmt0(payables.toApproveCents)}</div>
              <div className="m">{payables.toApproveCount ? `${payables.toApproveCount} contractor invoice${payables.toApproveCount === 1 ? "" : "s"}` : "nothing waiting"}</div>
            </div>
            <div className="tile week"><div className="k">To pay this week</div>
              <div className="v" data-testid="tile-to-pay">{fmt0(payables.toPayWeekCents)}</div>
              <div className="m">{payables.approvedCount ? `${payables.toPayWeekCount} of ${payables.approvedCount} approved` : "nothing approved"}</div>
            </div>
            {/* Tom, 20 Sep: the number of supplier invoices still to match to a job — a count, not a sum. */}
            <a className={`tile match ${materialsToMatchCount ? "pending" : ""}`} href="#materials-to-match" data-testid="tile-materials-to-match-link">
              <div className="k">Materials to match</div>
              <div className="v" data-testid="tile-materials-to-match">{materialsToMatchCount}</div>
              <div className="m">{materialsToMatchCount ? `supplier invoice${materialsToMatchCount === 1 ? "" : "s"} with no job yet` : "every supplier invoice is on a job"}</div>
            </a>
          </div>
        )}

        {/* Step 6a — the intake queue + job costs + unmatched materials */}
        {costs && (
          <PayablesCosts cards={costs.cards} jobs={costs.jobs} unmatched={costs.unmatched}
            costRows={costs.costRows} accuracy={costs.accuracy}
            expenseClaims={costs.expenseClaims} preapprovals={costs.preapprovals}
            reimbursements={costs.reimbursements} />
        )}

        {payMessage && <div className="hint" role="status" data-testid="payables-message" style={{ margin: "8px 0" }}>{payMessage}</div>}

        <div className="rows" data-testid="payable-rows">
          {payableRows.map((p) => (
            <div key={p.ciId} className={`r ${p.toneClass}`} data-tone={p.tone} data-testid={`payable-${p.ciId}`}>
              <div className="body">
                <div className="job">
                  {p.estimateId
                    ? <Link href={`/invoicing/job/${p.estimateId}`}>{p.company}</Link>
                    : p.company}
                  {p.rcti && <span className="chip draft" style={{ marginLeft: 8 }}>RCTI</span>}
                  {p.overdueLabel && <span className={`chip ${p.toneClass}`} style={{ marginLeft: 8 }} data-testid={`overdue-ci-${p.ciId}`}>{p.overdueLabel}</span>}
                </div>
                <div className="ref">{p.ref}</div>
                <div className={`age ${p.toneClass}`}>
                  {p.dueLabel}
                  {p.stageLabel ? <span style={{ opacity: 0.75 }}> · job: {p.stageLabel}</span> : null}
                </div>
              </div>
              <div className="right">
                <div className="amt">{fmt2(p.amtCents)}</div>
                <div className="acts" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {(p.status === "submitted" || (p.status === "draft" && p.rcti)) && (
                    <button className="mini cy" disabled={payBusy}
                      onClick={() => approveCi(p.ciId)} data-testid={`approve-ci-${p.ciId}`}>
                      Approve
                    </button>
                  )}
                  {p.status === "approved" && (
                    <button className="mini cy" disabled={payBusy}
                      onClick={() => markCiPaid(p.ciId)} data-testid={`pay-ci-${p.ciId}`}>
                      Mark paid
                    </button>
                  )}
                  {p.hasPdf && (
                    <a className="mini" href={`/invoicing/ci/${p.ciId}/pdf`} target="_blank" rel="noreferrer"
                      data-testid={`pdf-ci-${p.ciId}`} style={{ textDecoration: "none" }}>
                      Invoice PDF
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          {payableRows.length === 0 && (
            <div className="card"><div className="hint">
              No contractor invoices yet — one drafts itself the moment a job
              signs off. Nothing here moves money — it records and reminds.
            </div></div>
          )}
        </div>
      </section>

      {/* ================= ACTIVITY ================= */}
      <section className={`tab ${tab === "act" ? "on" : ""}`}>
        <div className="card" style={{ marginTop: 8 }}>
          {activity.length === 0 && <div className="hint">No invoice activity yet.</div>}
          {activity.map((e, i) => (
            <div className="ev" key={i}>
              <span className={`dot ${e.tone}`} />
              <div><div className="t">{e.title}</div><div className="m">{e.meta}</div></div>
            </div>
          ))}
        </div>
      </section>

      <div className="note">every figure reads from lib/invoicing · filters are shareable links</div>
    </div>
  );
}
