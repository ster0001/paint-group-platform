"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fmt2 } from "./format";
import JobSearch from "./JobSearch";
import {
  assignMaterialCostAction,
  approveJobCostAction,
  confirmIntakeAction,
  decideExpenseAction,
  decidePreapprovalAction,
  markJobCostPaidAction,
  rejectIntakeAction,
  type InvoicingResult,
} from "./actions";

/**
 * The Payables tab's cost-capture section (mockup:
 * design/reference/cost-capture-mockup.html · intake queue). One card per
 * pending document; Confirm opens a prefilled panel and the save writes the
 * destination row with the document attached — the AI read it, a person
 * confirms it, the ledger records it. Amounts here are operator-confirmed
 * intent; the SQL bounds them again.
 */

export type IntakeCardProp = {
  intakeId: string;
  title: string;
  sourceChip: string;
  kv: { k: string; v: string }[];
  failed: boolean;
  duplicate: boolean;
  duplicateNote: string;
  matchLabel: string | null;
  matchWhy: string | null;
  confidencePct: number | null;
  proposedWoId: string | null;
  vendorId: string | null;
  vendorName: string;
  totalCents: number;
  gstCents: number;
  invoiceNo: string;
  invoiceDate: string | null;
  docUrl: string | null;
};

export type JobPickProp = { woId: string; estimateId: string; label: string };

export type UnmatchedMaterialProp = {
  id: string;
  label: string; // "Haymes · $412.80 · 22 Aug"
  hint: string; // order ref / address text
};

export type CostPayableRowProp = {
  id: string;
  estimateId: string | null;
  vendor: string;
  ref: string; // "HP-88214 · scaffold · 12 Ellerslie Grove"
  status: "recorded" | "approved" | "paid";
  amtCents: number;
  docUrl: string | null;
};

export type ExpenseClaimProp = {
  id: string;
  contractor: string;
  ref: string; // "Sundries · $68.00 · PG-0005 · address"
  amtCents: number;
  overThreshold: boolean;
  note: string;
  receiptUrl: string | null;
};

export type PreapprovalProp = {
  id: string;
  contractor: string;
  ref: string;
  description: string;
  estCents: number;
};

export type AccuracyProp = {
  decided: number;
  exactRefPct: number | null;
  unchangedPct: number | null;
  correctedPct: number | null;
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "materials", label: "Materials" },
  { key: "scaffold", label: "Scaffold" },
  { key: "render", label: "Render" },
  { key: "carpentry", label: "Carpentry" },
  { key: "rubbish", label: "Rubbish" },
  { key: "equipment_hire", label: "Equipment" },
  { key: "permit", label: "Permit" },
  { key: "traffic_mgmt", label: "Traffic" },
  { key: "other", label: "Other" },
];

export default function PayablesCosts({
  cards, jobs, unmatched, costRows, accuracy, expenseClaims = [], preapprovals = [],
}: {
  cards: IntakeCardProp[];
  jobs: JobPickProp[];
  unmatched: UnmatchedMaterialProp[];
  costRows: CostPayableRowProp[];
  accuracy: AccuracyProp;
  expenseClaims?: ExpenseClaimProp[];
  preapprovals?: PreapprovalProp[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // intakeId with panel open
  const [assigning, setAssigning] = useState<string | null>(null); // material id

  // Panel state, seeded when a card opens.
  const [woId, setWoId] = useState<string | null>(null);
  const [category, setCategory] = useState("other");
  const [totalDollars, setTotalDollars] = useState("");
  const [gstDollars, setGstDollars] = useState("");
  const [vendorName, setVendorName] = useState("");

  const run = (fn: () => Promise<InvoicingResult>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.message ?? null);
      if (r.ok) {
        setOpen(null);
        setAssigning(null);
        router.refresh();
      }
    });

  function openPanel(c: IntakeCardProp) {
    setOpen(c.intakeId);
    setWoId(c.proposedWoId);
    setCategory(c.vendorName.toLowerCase().includes("paint") ? "materials" : "other");
    setTotalDollars(c.totalCents > 0 ? (c.totalCents / 100).toFixed(2) : "");
    setGstDollars(
      c.gstCents > 0 ? (c.gstCents / 100).toFixed(2)
      : c.totalCents > 0 ? (Math.round(c.totalCents / 11) / 100).toFixed(2)
      : "",
    );
    setVendorName(c.vendorName);
  }

  function confirm(c: IntakeCardProp) {
    const totalCents = Math.round(Number(totalDollars) * 100);
    const gstCents = Math.round(Number(gstDollars || "0") * 100);
    if (!(totalCents > 0) || gstCents < 0 || gstCents >= totalCents) {
      setMessage("Check the amounts — total inc GST, with GST no larger than the total.");
      return;
    }
    const destination = category === "materials" ? "material_cost" : "job_cost";
    if (destination === "job_cost" && !woId) {
      setMessage("Pick the job this cost belongs to.");
      return;
    }
    run(() =>
      confirmIntakeAction({
        intakeId: c.intakeId,
        destination,
        woId,
        estimateId: jobs.find((j) => j.woId === woId)?.estimateId ?? null,
        vendorId: c.vendorId,
        vendorName,
        category: destination === "job_cost" ? category : "other",
        description: c.title,
        amountExCents: totalCents - gstCents,
        gstCents,
        invoiceNo: c.invoiceNo,
        invoiceDate: c.invoiceDate,
      }),
    );
  }

  return (
    <div data-testid="cost-capture">
      {/* §2.1 — the accuracy readout: the evidence that rules ⚑A1 */}
      <div className="hint mono" style={{ margin: "10px 2px 0", fontSize: 10 }} data-testid="accuracy-readout">
        {accuracy.decided === 0
          ? "Intake accuracy: no documents decided yet"
          : `Intake accuracy · 30 days: ${accuracy.decided} decided · ${accuracy.exactRefPct ?? 0}% exact ref · ${accuracy.unchangedPct ?? 0}% confirmed unchanged · ${accuracy.correctedPct ?? 0}% corrected`}
      </div>

      {message && <div className="hint" role="status" data-testid="costs-message" style={{ margin: "8px 0" }}>{message}</div>}

      {/* ============ the intake queue ============ */}
      {cards.map((c) => (
        <div key={c.intakeId} className="card" data-testid={`intake-${c.intakeId}`}
          style={c.duplicate ? { borderColor: "rgba(179,87,74,.45)" } : undefined}>
          <div className="row">
            <h3>{c.title}</h3>
            <span className={`chip ${c.duplicate ? "overdue" : "draft"}`}>{c.duplicate ? "Possible duplicate" : c.sourceChip}</span>
          </div>

          {c.duplicate ? (
            <div className="hint" style={{ marginTop: 8 }}>{c.duplicateNote}</div>
          ) : c.failed ? (
            <div className="hint" style={{ marginTop: 8 }} data-testid={`intake-failed-${c.intakeId}`}>
              Couldn&apos;t read this document — open it and enter the details yourself. Nothing was recorded.
            </div>
          ) : (
            <div className="ikv">
              {c.kv.map((x) => (
                <div key={x.k}><div className="k">{x.k}</div><div className="v">{x.v}</div></div>
              ))}
            </div>
          )}

          {!c.duplicate && c.matchLabel && (
            <div className="hint" style={{ marginTop: 8, border: "1px dashed rgba(59,216,233,.4)", borderRadius: 10, padding: "8px 10px" }}>
              → <b style={{ color: "var(--text)" }}>{c.matchLabel}</b>
              <div className="mono" style={{ fontSize: 9, marginTop: 2 }}>
                {c.matchWhy}{c.confidencePct != null ? ` · ${c.confidencePct}%` : ""}
              </div>
            </div>
          )}

          <div className="acts" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {!c.duplicate && (
              <button className="mini cy" disabled={busy} data-testid={`confirm-${c.intakeId}`}
                onClick={() => (open === c.intakeId ? setOpen(null) : openPanel(c))}>
                Confirm
              </button>
            )}
            {c.docUrl && (
              <a className="mini" href={c.docUrl} target="_blank" rel="noreferrer">View document</a>
            )}
            <button className="mini" disabled={busy} data-testid={`reject-${c.intakeId}`}
              onClick={() => run(() => rejectIntakeAction({ intakeId: c.intakeId }))}>
              {c.duplicate ? "Dismiss" : "Reject"}
            </button>
          </div>

          {/* the confirm panel — prefilled from the reading, edited by a person */}
          {open === c.intakeId && !c.duplicate && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }} data-testid={`panel-${c.intakeId}`}>
              {/* The matched job: type the address, pick from the matches
                  (Tom, 4 Sep). A proposed match arrives pre-picked. */}
              <div className="k" style={{ marginBottom: 6 }}>Matched job</div>
              <JobSearch jobs={jobs} value={woId} onChange={setWoId}
                testId={`job-search-${c.intakeId}`}
                allowNone={category === "materials"} />
              <label className="k" htmlFor={`category-${c.intakeId}`} style={{ display: "block", margin: "10px 0 6px" }}>
                Expense type
              </label>
              <select id={`category-${c.intakeId}`} className="sel" value={category}
                onChange={(e) => setCategory(e.target.value)} data-testid={`category-${c.intakeId}`}>
                {CATEGORIES.map((cat) => (
                  <option key={cat.key} value={cat.key}>{cat.label}</option>
                ))}
              </select>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <label className="hint">Total inc GST ($)
                  <input type="number" inputMode="decimal" min={0.01} step="0.01" value={totalDollars}
                    onChange={(e) => setTotalDollars(e.target.value)} data-testid={`total-${c.intakeId}`}
                    style={{ width: "100%" }} />
                </label>
                <label className="hint">GST ($)
                  <input type="number" inputMode="decimal" min={0} step="0.01" value={gstDollars}
                    onChange={(e) => setGstDollars(e.target.value)}
                    style={{ width: "100%" }} />
                </label>
              </div>
              <label className="hint" style={{ display: "block", marginTop: 8 }}>Vendor
                <input type="text" value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                  style={{ width: "100%" }} />
              </label>
              <button className="btn primary" disabled={busy} style={{ marginTop: 12 }}
                onClick={() => confirm(c)} data-testid={`save-${c.intakeId}`}>
                Confirm cost{Number(totalDollars) > 0 ? ` — ${fmt2(Math.round(Number(totalDollars) * 100))}` : ""}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ============ unmatched materials — one-tap assign ============ */}
      {unmatched.length > 0 && (
        <div className="card" data-testid="unmatched-materials">
          <div className="row"><h3>Materials without a job</h3><span className="chip draft">{unmatched.length}</span></div>
          {unmatched.map((m) => (
            <div key={m.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.label}</div>
              <div className="hint mono" style={{ fontSize: 10 }}>{m.hint}</div>
              {assigning === m.id ? (
                <div style={{ marginTop: 8 }}>
                  <div className="k" style={{ marginBottom: 6 }}>Matched job</div>
                  <JobSearch jobs={jobs} value={null} autoFocus testId={`assign-search-${m.id}`}
                    onChange={(woId) => {
                      if (!woId || busy) return;
                      run(() => assignMaterialCostAction({ materialCostId: m.id, woId }));
                    }} />
                  <button className="mini" style={{ marginTop: 6 }} onClick={() => setAssigning(null)}>Cancel</button>
                </div>
              ) : (
                <button className="mini cy" style={{ marginTop: 8 }} onClick={() => setAssigning(m.id)}
                  data-testid={`assign-${m.id}`}>
                  Assign to job
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============ ask-first requests (6c) ============ */}
      {preapprovals.length > 0 && (
        <div className="card" data-testid="preapprovals">
          <div className="row"><h3>Ask-first — over-threshold purchases</h3><span className="chip submitted">{preapprovals.length}</span></div>
          {preapprovals.map((p) => (
            <div key={p.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }} data-testid={`preapproval-${p.id}`}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.contractor} — {p.description}</div>
              <div className="hint mono" style={{ fontSize: 10 }}>{p.ref} · about {fmt2(p.estCents)}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="mini cy" disabled={busy} data-testid={`approve-pre-${p.id}`}
                  onClick={() => {
                    const cap = window.prompt("Approve up to how much? (dollars)", (p.estCents / 100).toFixed(2));
                    if (cap === null) return;
                    const cents = Math.round(Number(cap) * 100);
                    if (!(cents > 0)) { setMessage("Enter a dollar cap."); return; }
                    run(() => decidePreapprovalAction({ preapprovalId: p.id, approve: true, capCents: cents }));
                  }}>
                  Approve…
                </button>
                <button className="mini" disabled={busy} data-testid={`decline-pre-${p.id}`}
                  onClick={() => run(() => decidePreapprovalAction({ preapprovalId: p.id, approve: false }))}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============ contractor expense claims (6c) ============ */}
      {expenseClaims.length > 0 && (
        <div className="card" data-testid="expense-claims">
          <div className="row"><h3>Contractor expense claims</h3><span className="chip submitted">{expenseClaims.length}</span></div>
          {expenseClaims.map((e) => (
            <div key={e.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }} data-testid={`expense-claim-${e.id}`}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {e.contractor} · {fmt2(e.amtCents)}
                {e.overThreshold && <span className="chip submitted" style={{ marginLeft: 6 }}>over threshold, no pre-approval</span>}
              </div>
              <div className="hint mono" style={{ fontSize: 10 }}>{e.ref}{e.note ? ` · ${e.note}` : ""}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="mini cy" disabled={busy} data-testid={`approve-exp-${e.id}`}
                  onClick={() => run(() => decideExpenseAction({ expenseId: e.id, approve: true }))}>
                  Approve
                </button>
                <button className="mini" disabled={busy} data-testid={`reject-exp-${e.id}`}
                  onClick={() => run(() => decideExpenseAction({ expenseId: e.id, approve: false }))}>
                  Reject
                </button>
                {e.receiptUrl && <a className="mini" href={e.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============ job costs — recorded → approved → paid ============ */}
      {costRows.length > 0 && (
        <div className="rows" data-testid="job-cost-rows" style={{ marginTop: 12 }}>
          {costRows.map((r) => (
            <div key={r.id} className="r" data-testid={`job-cost-${r.id}`}>
              <div className="body">
                <div className="job">
                  {r.estimateId ? <Link href={`/invoicing/job/${r.estimateId}`}>{r.vendor}</Link> : r.vendor}
                </div>
                <div className="ref">{r.ref}</div>
                <div className={`age ${r.status === "paid" ? "emerald" : r.status === "approved" ? "cyan" : "amber"}`}>
                  {r.status === "recorded" ? "Recorded — approve to queue payment" : r.status === "approved" ? "Approved — pay when ready" : "Paid"}
                </div>
              </div>
              <div className="right">
                <div className="amt">{fmt2(r.amtCents)}</div>
                <div className="acts" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {r.status === "recorded" && (
                    <button className="mini cy" disabled={busy} data-testid={`approve-cost-${r.id}`}
                      onClick={() => run(() => approveJobCostAction({ jobCostId: r.id, estimateId: r.estimateId }))}>
                      Approve
                    </button>
                  )}
                  {r.status === "approved" && (
                    <button className="mini cy" disabled={busy} data-testid={`pay-cost-${r.id}`}
                      onClick={() => {
                        const today = new Date().toISOString().slice(0, 10);
                        const paidOn = window.prompt("Payment date (yyyy-mm-dd):", today);
                        if (paidOn === null) return;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn.trim())) {
                          setMessage("That date needs to be yyyy-mm-dd — nothing was recorded.");
                          return;
                        }
                        run(() => markJobCostPaidAction({ jobCostId: r.id, estimateId: r.estimateId, paidOn: paidOn.trim() }));
                      }}>
                      Mark paid
                    </button>
                  )}
                  {r.docUrl && (
                    <a className="mini" href={r.docUrl} target="_blank" rel="noreferrer">Doc</a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {cards.length === 0 && unmatched.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="hint" data-testid="intake-empty">
            Intake queue is clear. Anything sent to bills@ lands here read and
            matched — confirm writes the cost with the document attached.
          </div>
        </div>
      )}
    </div>
  );
}
