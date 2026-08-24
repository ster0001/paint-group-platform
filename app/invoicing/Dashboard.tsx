"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { DashboardTiles, PayablesTiles } from "@/lib/invoicing/derive";
import { fmt0, fmt2 } from "./format";
import { approveContractorInvoiceAction, markContractorInvoicePaidAction } from "./actions";

/**
 * §7.2 client shell — tabs, filter chips (mirrored into query params so a
 * filtered view is shareable), rows, aged bar. Renders only: every number
 * arrives computed from lib/invoicing via the server page.
 */

export type RowProp = {
  invoiceId: string;
  estimateId: string;
  job: string;
  ref: string;
  filter: "overdue" | "awaiting" | "partial" | "draft" | "paid" | "other";
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
  rcti: boolean;
  /** The job's stage from PC control — the Payables row carries it (Tom, 24 Aug). */
  stageLabel: string;
  hasPdf: boolean;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "awaiting", label: "Awaiting" },
  { key: "partial", label: "Partially paid" },
  { key: "draft", label: "Draft" },
  { key: "paid", label: "Paid" },
];

const BUCKET_LABELS = ["current", "1–7 d", "8–14 d", "15–30 d", "30+ d"];
const BUCKET_COLOURS = ["var(--paint)", "var(--clay)", "var(--clay)", "var(--clay)", "var(--clay)"];

export default function Dashboard({
  tiles, buckets, rows, activity, initialFilter, initialTab,
  payables = null, payableRows = [],
}: {
  tiles: DashboardTiles;
  buckets: [number, number, number, number, number];
  rows: RowProp[];
  activity: ActivityProp[];
  initialFilter: string;
  initialTab: string;
  payables?: PayablesTiles | null;
  payableRows?: PayableRowProp[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab === "pay" || initialTab === "act" ? initialTab : "recv");
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "all");
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

  const setUrl = (nextTab: string, nextFilter: string) => {
    const q = new URLSearchParams();
    if (nextTab !== "recv") q.set("tab", nextTab);
    if (nextFilter !== "all") q.set("f", nextFilter);
    router.replace(`/invoicing${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  const counts: Record<string, number> = { all: rows.length };
  for (const f of FILTERS.slice(1)) counts[f.key] = rows.filter((r) => r.filter === f.key).length;

  const visible = filter === "all" ? rows : rows.filter((r) => r.filter === filter);
  const bucketTotal = buckets.reduce((a, b) => a + b, 0);
  const sparkMax = Math.max(...tiles.collectedSpark, 1);

  return (
    <div className="wrap">
      <header>
        <div className="crumb"><Link href="/pc"><span className="chev">‹</span> PC Command</Link></div>
        <h1>Payments</h1>
        <div className="sub">All jobs · receivables &amp; payables · <Link href="/invoices">invoice list →</Link></div>
      </header>

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
        <div className="filters">
          {FILTERS.map((fx) => (
            <button key={fx.key} className={`f ${filter === fx.key ? "on" : ""}`}
              onClick={() => { setFilter(fx.key); setUrl(tab, fx.key); }}>
              {fx.label}<b>{counts[fx.key] ?? 0}</b>
            </button>
          ))}
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
            <div className="card"><div className="hint">Nothing here — change the filter, or accept an estimate and the deposit draft appears on its own.</div></div>
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
          </div>
        )}

        {payMessage && <div className="hint" role="status" data-testid="payables-message" style={{ margin: "8px 0" }}>{payMessage}</div>}

        <div className="rows" data-testid="payable-rows">
          {payableRows.map((p) => (
            <div key={p.ciId} className="r" data-testid={`payable-${p.ciId}`}>
              <div className="body">
                <div className="job">
                  {p.estimateId
                    ? <Link href={`/invoicing/job/${p.estimateId}`}>{p.company}</Link>
                    : p.company}
                  {p.rcti && <span className="chip draft" style={{ marginLeft: 8 }}>RCTI</span>}
                </div>
                <div className="ref">{p.ref}</div>
                <div className={`age ${p.status === "submitted" ? "amber" : p.status === "approved" ? "cyan" : p.status === "paid" ? "emerald" : ""}`}>
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
              signs off. Job costs and the materials queue join this tab in
              Step 6. Nothing here moves money — it records and reminds.
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
