"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  issueAndSendAction,
  recordDriftAsVariationAction,
  recordPaymentAction,
  reconcileAdjustmentAction,
  removeLineAction,
  resendInvoiceAction,
  setDraftTotalAction,
  updateLineAction,
  voidInvoiceAction,
  type InvoicingResult,
} from "../../actions";
import { fmt2, fmtSigned2, kindLabelWithContext, STATUS_LABEL } from "../../format";
import SendInvoiceSheet from "../../SendInvoiceSheet";

/**
 * §7.3 client — the document editor. Every edit submits INTENT to a server
 * action; lib/invoicing (via the RPCs) returns the recomputed document.
 * Drift from the job ledger is server-computed and shown in the amber
 * reconciliation banner with its two one-tap resolutions; the emerald
 * "reconciles to the job ledger" line is the resting state.
 */

export type DocLine = {
  id: string;
  source: "estimate_snapshot" | "variation" | "manual" | "adjustment";
  title: string;
  detail: string;
  description: string;
  amountExCents: number;
  approvedOn: string | null;
};

export type DocPayment = { label: string; sub: string; amountCents: number };

export default function InvoiceDoc({
  invoiceId, estimateId, kind, status, number, token, isDraft, totals, meta, entity, bank, lines, payments, prevNumbers,
}: {
  invoiceId: string;
  estimateId: string;
  kind: string;
  status: string;
  number: string | null;
  token: string;
  isDraft: boolean;
  totals: {
    subtotalExCents: number; gstCents: number; totalIncCents: number;
    adjustedCents: number; previouslyInvoicedCents: number;
    driftCents: number; decisionDriftCents: number | null;
  };
  meta: { billedTo: string; address: string; jobTitle: string; woRef: string | null; issued: string | null; due: string | null };
  entity: Record<string, string>;
  bank: Record<string, string>;
  lines: DocLine[];
  payments: DocPayment[];
  prevNumbers: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | "total" | null>(null);
  const [desc, setDesc] = useState("");
  const [dollars, setDollars] = useState("");
  const [paySheet, setPaySheet] = useState(false);
  const [sendSheet, setSendSheet] = useState<null | "issue" | "resend">(null);
  const [payMethod, setPayMethod] = useState<"bank_transfer" | "cash" | "other">("bank_transfer");
  const [payDollars, setPayDollars] = useState("");
  const [payRef, setPayRef] = useState("");

  const run = (fn: () => Promise<InvoicingResult>) =>
    startTransition(async () => {
      const r = await fn();
      setFlash(r.ok ? (r.message ?? null) : r.message);
      if (r.ok) { setEditing(null); setPaySheet(false); setSendSheet(null); router.refresh(); }
    });

  const contract = lines.filter((l) => l.source === "estimate_snapshot");
  const variations = lines.filter((l) => l.source === "variation");
  const manual = lines.filter((l) => l.source === "manual" || l.source === "adjustment");

  const isFinal = kind === "final";
  const drift = totals.driftCents;
  const driftResolved = totals.decisionDriftCents !== null && totals.decisionDriftCents === drift;
  const incAnchored = kind === "deposit" || kind === "progress";

  const startEdit = (l: DocLine) => {
    setEditing(l.id);
    setDesc(l.description);
    setDollars((l.amountExCents / 100).toFixed(2));
  };

  const lineEditor = (l: DocLine) => (
    <div className="line" style={{ display: "block" }}>
      <input type="text" style={editInput} value={desc} placeholder="Line description"
        onChange={(e) => setDesc(e.target.value)} data-testid="line-desc" />
      <input type="number" step="0.01" style={{ ...editInput, marginTop: 8 }} value={dollars}
        placeholder="Amount ex GST (dollars)" onChange={(e) => setDollars(e.target.value)} data-testid="line-amount" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="mini cy" disabled={busy || !desc.trim() || !Number.isFinite(Number(dollars))}
          onClick={() => run(() => updateLineAction({ invoiceId, estimateId, lineId: l.id, description: desc.trim(), amountExCents: Math.round(Number(dollars) * 100) }))}>
          Save
        </button>
        <button className="mini" disabled={busy}
          onClick={() => { if (confirm("Remove this line from the claim?")) run(() => removeLineAction({ invoiceId, estimateId, lineId: l.id })); }}>
          Remove
        </button>
        <button className="mini" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </div>
  );

  const renderLine = (l: DocLine) =>
    editing === l.id ? (
      <div key={l.id}>{lineEditor(l)}</div>
    ) : (
      <div className={`line ${l.source === "variation" ? "vline" : ""}`} key={l.id}>
        <div>
          <div className="n">{l.title}</div>
          {l.detail && <div className="d2">{l.detail}</div>}
          {l.approvedOn && <div className="appr">✓ {l.approvedOn}</div>}
        </div>
        <div className="a">{fmtSigned2(l.amountExCents)}</div>
        {isDraft && <button className="edit" aria-label="Edit line" onClick={() => startEdit(l)}>✎</button>}
      </div>
    );

  return (
    <div className="wrap">
      <header>
        <div className="crumb">
          <Link href="/invoicing"><span className="chev">‹</span> Invoicing</Link>
          <span>·</span>
          <Link href={`/invoicing/job/${estimateId}`}>{meta.address || "Job"} · Money view</Link>
        </div>
        <h1>
          {kindLabelWithContext(kind, totals.totalIncCents, totals.adjustedCents)} invoice
          <span className={`chip ${isDraft ? "draft" : status === "paid" ? "paid" : status === "void" ? "overdue" : "sent"}`} style={{ marginLeft: 8 }}>
            {isDraft ? "Draft — check before sending" : STATUS_LABEL[status]}
          </span>
        </h1>
        <div className="sub">{isDraft ? "Number allocated when issued" : number}{meta.woRef ? ` · ${meta.woRef}` : ""}</div>
      </header>

      {flash && <div className="banner"><div className="i">●</div><p>{flash}</p></div>}

      {isDraft && (
        <div className="banner">
          <div className="i">✎</div>
          <p><b>Editable while draft.</b> Lines are seeded from the accepted estimate and approved variations. Amend descriptions or amounts freely — if the total moves away from the job ledger, the amber banner below shows the difference. <b>Issuing locks the document</b>{" "}and allocates the number.</p>
        </div>
      )}

      {isFinal && isDraft && drift !== 0 && !driftResolved && (
        <div className="banner" data-testid="reconciliation-banner">
          <div className="i">⚠</div>
          <p>
            <b>{fmtSigned2(Math.abs(drift))} {drift > 0 ? "above" : "below"} the job ledger.</b>{" "}
            The ledger says the balance owing is {fmt2(totals.totalIncCents - drift)}; this document totals {fmt2(totals.totalIncCents)}. Silent drift isn&apos;t allowed — pick how to record it:
            <span className="bacts">
              <button className="mini cy" disabled={busy} onClick={() => {
                const comment = prompt("Record the difference as a variation — what is it? (PC-entered, override-logged.)");
                if (comment?.trim()) run(() => recordDriftAsVariationAction({ invoiceId, estimateId, comment: comment.trim() }));
              }}>Record as variation</button>
              <button className="mini" disabled={busy} onClick={() => {
                const note = prompt("Keep as a one-off adjustment — add a note (optional):") ?? "";
                run(() => reconcileAdjustmentAction({ invoiceId, estimateId, note: note.trim() }));
              }}>Keep as one-off adjustment</button>
            </span>
          </p>
        </div>
      )}

      <div className="doc">
        <div className="doc-head">
          <div className="brand">PAINT<span>GROUP</span></div>
          <div className="brand-sub">{entity.brandSub || "Painting · Plastering · Restoration"}</div>
          <div className="entity">
            {entity.address} · ABN {entity.abn}<br />
            Banking: {bank.accountName} · {bank.bank}{bank.bsb ? ` · BSB ${bank.bsb} ACC ${bank.acc}` : ""} · ref {number ?? "INV number"}<br />
            <span style={{ color: "var(--text)" }}>TAX INVOICE</span> · details from Settings — edit there, not here
          </div>
        </div>

        <div className="doc-meta">
          <div><div className="k">Billed to</div><div className="v">{meta.billedTo}<small>{meta.address}</small></div></div>
          <div><div className="k">Job</div><div className="v">{meta.jobTitle || "—"}<small>{meta.woRef ?? ""}</small></div></div>
          <div><div className="k">Invoice no.</div><div className="v mono">{number ?? "— at issue"}</div></div>
          <div><div className="k">Due</div><div className="v mono">{meta.due ?? "issue + 7 days"}</div></div>
        </div>

        {contract.length > 0 && (
          <>
            <div className="grp-h"><span className="t">Contract works — from accepted estimate</span></div>
            {contract.map(renderLine)}
          </>
        )}
        {variations.length > 0 && (
          <>
            <div className="grp-h"><span className="t">Variations — approved during the job</span></div>
            {variations.map(renderLine)}
          </>
        )}
        {manual.length > 0 && (
          <>
            {(contract.length > 0 || variations.length > 0) && (
              <div className="grp-h"><span className="t">This claim</span></div>
            )}
            {manual.map(renderLine)}
          </>
        )}

        {/* Tom's ruling (24 Aug follow-up): NO manual lines. Every change to
            the invoice travels through Revise scope — measured, engine-priced,
            and SIGNED — so nothing lands here the customer didn't approve. */}
        {isDraft && (
          <a className="add-line" href={`/quote?id=${estimateId}&mode=revision`}
            style={{ display: "block", textAlign: "center", textDecoration: "none" }}
            data-testid="revise-scope-hint">
            Need to change this invoice? Revise scope — priced by the engine, signed by the customer →
          </a>
        )}

        <div className="totals">
          {isFinal && (
            <>
              <div className="trow"><span>Adjusted contract (incl. variations)</span><b>{fmt2(totals.adjustedCents)}</b></div>
              {totals.previouslyInvoicedCents > 0 && (
                <div className="trow"><span>Less previously invoiced{prevNumbers ? ` — ${prevNumbers}` : ""}</span><b>−{fmt2(totals.previouslyInvoicedCents)}</b></div>
              )}
            </>
          )}
          <div className="trow"><span>This invoice — subtotal</span><b>{fmt2(totals.subtotalExCents)}</b></div>
          <div className="trow"><span>GST (10%)</span><b>{fmt2(totals.gstCents)}</b></div>
          <div className="trow big"><span>{isFinal ? "Balance due" : "Total inc GST"}</span><b data-testid="doc-total">{fmt2(totals.totalIncCents)}</b></div>
          {isFinal && (
            drift === 0
              ? <div className="recon" data-testid="recon-line">● Reconciles to the job ledger — nothing owed after this invoice</div>
              : driftResolved
                ? <div className="recon" data-testid="recon-line">● Off-ledger by {fmtSigned2(drift)} — recorded as a one-off adjustment</div>
                : <div className="recon amber" data-testid="recon-line">● {fmtSigned2(drift)} against the job ledger — resolve in the banner above</div>
          )}
          {isDraft && incAnchored && (
            editing === "total" ? (
              <div style={{ marginTop: 10 }}>
                <input type="number" step="0.01" style={editInput} value={dollars} placeholder="New total inc GST (dollars)"
                  onChange={(e) => setDollars(e.target.value)} data-testid="amend-total" />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="mini cy" disabled={busy || !(Number(dollars) > 0)}
                    onClick={() => run(() => setDraftTotalAction({ invoiceId, estimateId, totalIncCents: Math.round(Number(dollars) * 100) }))}>
                    Save new total
                  </button>
                  <button className="mini" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="mini" style={{ marginTop: 10 }} onClick={() => { setEditing("total"); setDollars((totals.totalIncCents / 100).toFixed(2)); }}>
                Amend the amount
              </button>
            )
          )}
        </div>
      </div>

      <div className="card">
        <h3>Payments — this job</h3>
        {payments.length === 0 && <div className="hint" style={{ marginTop: 6 }}>Nothing received yet.</div>}
        {payments.map((p, i) => (
          <div className="pay" key={i}>
            <div><div className="m">{p.label}</div><div className="s">{p.sub}</div></div>
            <div className="amt">{fmt2(p.amountCents)}</div>
          </div>
        ))}
        <div className="payacts">
          <button className="mini" disabled={!["issued", "sent", "viewed", "partially_paid"].includes(status)}
            onClick={() => { setPaySheet(true); setPayDollars((Math.max(totals.totalIncCents, 0) / 100).toFixed(2)); }}>
            Record payment
          </button>
          <Link className="mini cy" href={`/invoicing/job/${estimateId}`}>Request payment</Link>
        </div>
      </div>

      <div className="secacts">
        <a className="mini" href={`/i/${token}?preview=1`} target="_blank" rel="noreferrer">Preview as customer</a>
        <button className="mini" disabled={isDraft} title={isDraft ? "The link goes live at issue" : undefined}
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/i/${token}`)
              .then(() => setFlash("Pay link copied — paste it anywhere."))
              .catch(() => setFlash(`Pay link: ${window.location.origin}/i/${token}`));
          }}>
          Copy pay link
        </button>
        {isDraft ? (
          <button className="mini" disabled title="The PDF generates at issue and never changes after">PDF</button>
        ) : (
          <a className="mini" href={`/invoicing/inv/${invoiceId}/pdf`} target="_blank" rel="noreferrer">PDF</a>
        )}
        {!isDraft && ["issued", "sent", "viewed", "partially_paid"].includes(status) && (
          <button className="mini" disabled={busy} onClick={() => setSendSheet("resend")}>
            Send again
          </button>
        )}
      </div>

      <div className="note">
        Once issued: number allocated · PDF generated &amp; locked · edits become void-and-reissue or credit note.
      </div>

      <div className="actions">
        <Link className="btn ghost" href={`/invoicing/job/${estimateId}`}>Back to the job</Link>
        {isDraft ? (
          <button className="btn primary" disabled={busy}
            onClick={() => { if (confirm("Issue this invoice and send it to the customer? The number is allocated, the PDF is generated and the document locks.")) setSendSheet("issue"); }}>
            Issue &amp; send…
          </button>
        ) : ["issued", "sent", "viewed", "partially_paid"].includes(status) ? (
          <button className="btn ghost" disabled={busy} onClick={() => {
            const reason = prompt("Void this invoice — what's the reason? (The number is burnt, not reused.)");
            if (reason?.trim()) run(() => voidInvoiceAction({ invoiceId, estimateId, reason: reason.trim() }));
          }}>Void…</button>
        ) : (
          <span className="btn ghost" style={{ opacity: 0.6 }}>{STATUS_LABEL[status]}</span>
        )}
      </div>

      {/* record payment sheet */}
      <SendInvoiceSheet
        open={sendSheet !== null}
        verb={sendSheet === "resend" ? "Send again" : "Issue & send"}
        busy={busy}
        onClose={() => setSendSheet(null)}
        onSend={({ message, via }) =>
          run(() => (sendSheet === "resend"
            ? resendInvoiceAction({ invoiceId, estimateId, message, via })
            : issueAndSendAction({ invoiceId, estimateId, message, via })))}
      />
      <div className="scrim" onClick={() => setPaySheet(false)} style={paySheet ? { opacity: 1, pointerEvents: "auto" } : undefined} />
      <div className="sheet" role="dialog" aria-label="Record a payment" style={paySheet ? { transform: "none" } : undefined}>
        <h3>Record a payment</h3>
        <div className="hint">{number ?? "This invoice"} · bounded server-side against the balance.</div>
        <div className="chips">
          {([["bank_transfer", "Bank"], ["cash", "Cash"], ["other", "Other"]] as const).map(([k, label]) => (
            <button key={k} className={`pchip ${payMethod === k ? "on" : ""}`} onClick={() => setPayMethod(k)}>{label}</button>
          ))}
        </div>
        <input type="number" inputMode="decimal" min={0.01} step="0.01" placeholder="Amount received (dollars)"
          value={payDollars} onChange={(e) => setPayDollars(e.target.value)} />
        <input type="text" placeholder="Reference (optional)" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn ghost" onClick={() => setPaySheet(false)}>Cancel</button>
          <button className="btn primary" disabled={busy || !(Number(payDollars) > 0)}
            onClick={() => run(() => recordPaymentAction({
              invoiceId, estimateId, method: payMethod,
              amountCents: Math.round(Number(payDollars) * 100), reference: payRef,
            }))}>
            Record
          </button>
        </div>
      </div>
    </div>
  );
}

const editInput: React.CSSProperties = {
  width: "100%", appearance: "none", border: "1px solid var(--line)",
  background: "var(--ink)", color: "var(--text)", fontFamily: "var(--mono)",
  fontSize: 13, padding: "10px 11px", borderRadius: 9,
};
