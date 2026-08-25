"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PaymentStage } from "@/lib/invoicing/derive";
import { requestPreviewCents } from "@/lib/invoicing/derive";
import { gstFromIncCents } from "@/lib/invoicing/gst";
import {
  invoiceInFullAction,
  issueAndSendAction,
  recordPaymentAction,
  requestPaymentAction,
  deleteDraftAction,
  voidInvoiceAction,
  type InvoicingResult,
} from "../../actions";
import { fmt0, fmt2, fmtSigned2 } from "../../format";
import AddCostSheet from "./AddCostSheet";
import SendInvoiceSheet from "../../SendInvoiceSheet";

export type JobCostItemProp = {
  id: string;
  vendor: string;
  ref: string; // "scaffold · SR-2291 · 22 Aug"
  amtCents: number;
  status: "recorded" | "approved" | "paid";
  sourceChip: string; // bills@ / receipt / airtable / manual
  docUrl: string | null;
  linked: boolean; // ties to an estimate pass-through line
};

export type MaterialItemProp = {
  id: string;
  label: string; // "Haymes · $412.80 · 22 Aug"
  sourceChip: string;
  docUrl: string | null;
};

/**
 * §7.1 client shell — stage rail, money strip, three tabs, the
 * request-payment sheet and the record-payment sheet. Numbers arrive
 * computed; the preview figures come from lib/invoicing mirrors; every
 * mutation is a server action over an RPC.
 */

export type InvoiceCardProp = {
  invoiceId: string;
  token: string;
  num: string;
  statusLabel: string;
  chip: "paid" | "awaiting" | "sent" | "overdue" | "draft";
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issued: string;
  method: string | null;
  receipt: string | null;
  isDraft: boolean;
  isOpen: boolean;
  kind: string;
};

export type FeedProp = { tone: string; title: string; meta: string };

const STAGE_LABEL: Record<PaymentStage["key"], string> = {
  deposit: "Deposit", progress: "Progress", final: "Final", paid_in_full: "Paid in full",
};

export default function MoneyView({
  estimateId, woId, woRef, address, jobTitle, stages, strip, cards, feed, costs,
}: {
  estimateId: string;
  woId: string | null;
  woRef: string | null;
  address: string;
  jobTitle: string;
  stages: PaymentStage[];
  strip: {
    contractCents: number; variationsCents: number; invoicedCents: number;
    paidCents: number; balanceCents: number; adjustedCents: number;
  };
  cards: InvoiceCardProp[];
  feed: FeedProp[];
  costs: {
    offerCents: number; acceptedDeltaCents: number;
    ci?: { number: string | null; status: string } | null;
    rows?: JobCostItemProp[];
    materials?: MaterialItemProp[];
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"payments" | "invoices" | "costs">("payments");
  const [sheet, setSheet] = useState<null | "request" | { record: InvoiceCardProp }>(null);
  const [addCost, setAddCost] = useState(false);
  const [sendFor, setSendFor] = useState<string | null>(null); // invoiceId
  const [busy, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  // Request-payment sheet state — the sheet only sends the CHOICE (§4.2).
  const [mode, setMode] = useState<"10" | "25" | "50" | "custom" | "fixed">("25");
  const [customPct, setCustomPct] = useState("");
  const [fixedDollars, setFixedDollars] = useState("");
  // Record-payment sheet state.
  const [payMethod, setPayMethod] = useState<"bank_transfer" | "cash" | "other">("bank_transfer");
  const [payDollars, setPayDollars] = useState("");
  const [payRef, setPayRef] = useState("");

  const run = (fn: () => Promise<InvoicingResult>, after?: (r: InvoicingResult) => void) =>
    startTransition(async () => {
      const r = await fn();
      setFlash(r.ok ? (r.message ?? null) : r.message);
      if (r.ok) { setSheet(null); router.refresh(); after?.(r); }
    });

  const pct = mode === "custom" ? Number(customPct) : mode === "fixed" ? null : Number(mode);
  const previewCents =
    pct != null && pct > 0 && pct <= 100
      ? requestPreviewCents(strip.adjustedCents, pct)
      : mode === "fixed" && Number(fixedDollars) > 0
        ? Math.round(Number(fixedDollars) * 100)
        : null;

  const openCard = cards.find((c) => c.isOpen);
  const draftDeposit = cards.find((c) => c.kind === "deposit" && c.isDraft);

  return (
    <div className="wrap">
      <header>
        <div className="crumb">
          <Link href={woId ? `/pc/wo/${woId}` : "/pc"}><span className="chev">‹</span> PC Command{woRef ? <> · Work order <span className="mono" style={{ fontSize: 11 }}>{woRef}</span></> : null}</Link>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 14 }}>
            {/* The scope door (addendum A2): every accepted job's cost breakdown
                is editable in the revision builder — the diff becomes signed,
                engine-priced variations that this ledger then reads. */}
            <Link href={`/quote?id=${estimateId}&mode=revision`} data-testid="revision-builder-link">
              Revise scope in builder
            </Link>
            <Link href="/invoicing">Invoicing</Link>
          </span>
        </div>
        <h1>{address}</h1>
        <div className="sub">{jobTitle ? `${jobTitle} · ` : ""}Money view</div>
        {/* The one door for changing what this job charges (Tom, 24 Aug):
            everything is measured, engine-priced and customer-SIGNED there —
            the invoice editor no longer takes manual lines. */}
        <Link
          href={`/quote?id=${estimateId}&mode=revision`}
          data-testid="revise-scope-button"
          style={{
            display: "inline-block", marginTop: 12,
            background: "var(--amber, #e0a83c)", color: "#141414",
            fontWeight: 700, fontSize: 13, padding: "10px 16px",
            borderRadius: 10, textDecoration: "none",
          }}
        >
          ✎ Revise scope — price &amp; sign changes to this invoice
        </Link>
      </header>

      {/* payment stage progress bar */}
      <div className="stages" aria-label="Payment stages" data-testid="stage-rail">
        {stages.map((s) => (
          <div key={s.key} className={`stage ${s.state}`}>
            <div className="bar" />
            <div className="lab">{STAGE_LABEL[s.key]}</div>
            <div className="val">{s.state === "paid" && s.key !== "paid_in_full" ? `${fmt0(s.amountCents ?? 0)} ✓` : s.amountCents != null ? fmt0(s.amountCents) : s.state === "paid" ? "✓" : "—"}</div>
          </div>
        ))}
      </div>

      {/* money strip */}
      <div className="strip" data-testid="money-strip">
        <div className="cell"><div className="k">Contract</div><div className="v">{fmt0(strip.contractCents)}</div></div>
        <div className="cell"><div className="k">Variations</div><div className={`v ${strip.variationsCents > 0 ? "plus" : ""}`}>{strip.variationsCents === 0 ? "—" : (strip.variationsCents > 0 ? "+" : "−") + fmt0(Math.abs(strip.variationsCents))}</div></div>
        <div className="cell"><div className="k">Invoiced</div><div className="v">{fmt0(strip.invoicedCents)}</div></div>
        <div className="cell"><div className="k">Paid</div><div className="v">{fmt0(strip.paidCents)}</div></div>
        <div className="cell bal"><div className="k">Balance</div><div className="v" data-testid="strip-balance">{fmt0(strip.balanceCents)}</div></div>
      </div>

      <nav className="tabs">
        <button className={tab === "payments" ? "on" : undefined} onClick={() => setTab("payments")}>Payments</button>
        <button className={tab === "invoices" ? "on" : undefined} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={tab === "costs" ? "on" : undefined} onClick={() => setTab("costs")}>Costs</button>
      </nav>

      {flash && <div className="card raised" style={{ margin: "0 16px" }}><div className="hint">{flash}</div></div>}

      {/* ================= PAYMENTS ================= */}
      <section className={`tab ${tab === "payments" ? "on" : ""}`}>
        {draftDeposit && (
          <div className="card raised" data-testid="deposit-draft-card">
            <div className="row"><h3>Deposit drafted — review before it goes out</h3><span className="chip draft">Draft</span></div>
            <div className="hint" style={{ marginTop: 6 }}>
              Auto-drafted when the customer accepted · <span className="mono">{fmt2(draftDeposit.totalCents)}</span>.
              Amend or issue it from the document.
            </div>
            <div className="payacts">
              <Link className="mini cy" href={`/invoicing/inv/${draftDeposit.invoiceId}`}>Open the draft</Link>
              <button className="mini" disabled={busy}
                onClick={() => setSendFor(draftDeposit.invoiceId)}>
                Issue &amp; send
              </button>
            </div>
          </div>
        )}

        {!draftDeposit && openCard && (
          <div className="card raised">
            <div className="row"><h3>{openCard.num.split(" · ")[1]} invoice awaiting payment</h3><span className={`chip ${openCard.chip}`}>{openCard.chip === "sent" ? "Sent" : openCard.statusLabel.split(" · ")[0]}</span></div>
            <div className="hint" style={{ marginTop: 6 }}>
              {openCard.num.split(" · ")[0]} · <span className="mono">{fmt2(openCard.balanceCents)}</span> {openCard.statusLabel.toLowerCase()}. Actions are on the invoice card.
            </div>
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 2 }}>Activity</h3>
          <div className="feed" data-testid="job-feed">
            {feed.length === 0 && <div className="hint">Nothing yet — activity lands here as invoices move.</div>}
            {feed.map((e, i) => (
              <div className="ev" key={i}><span className={`dot ${e.tone}`} /><div><div className="t">{e.title}</div><div className="m">{e.meta}</div></div></div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= INVOICES ================= */}
      <section className={`tab ${tab === "invoices" ? "on" : ""}`}>
        {cards.length === 0 && <div className="card"><div className="hint">No invoices yet.</div></div>}
        {cards.map((c) => (
          <div className="card inv" key={c.invoiceId} style={c.isDraft ? { borderStyle: "dashed" } : undefined} data-testid={`invoice-card-${c.kind}`}>
            <div className="row"><span className="num">{c.num}</span><span className={`chip ${c.chip}`}>{c.statusLabel}</span></div>
            <div className="amt">{fmt2(c.totalCents)} <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>inc GST</span></div>
            <div className="meta">
              <div>Paid<b>{fmt2(c.paidCents)}</b></div>
              <div>Balance<b>{fmt2(c.balanceCents)}</b></div>
              {c.method ? <div>Method<b>{c.method === "bank_transfer" ? "Bank" : c.method === "stripe_card" ? "Stripe card" : c.method}</b></div> : <div>Issued<b>{c.issued}</b></div>}
              {c.receipt ? <div>Receipt<b>{c.receipt}</b></div> : null}
            </div>
            <div className="acts">
              <Link className="mini cy" href={`/invoicing/inv/${c.invoiceId}`}>Open</Link>
              {c.isDraft && (
                <>
                  <button className="mini" disabled={busy} onClick={() => setSendFor(c.invoiceId)}>Issue &amp; send</button>
                  <button className="mini" disabled={busy} onClick={() => { if (confirm("Delete this draft? Drafts are the only deletable invoices.")) run(() => deleteDraftAction({ invoiceId: c.invoiceId, estimateId })); }}>Delete</button>
                </>
              )}
              {c.isOpen && (
                <>
                  <button className="mini" disabled={busy} onClick={() => { setSheet({ record: c }); setPayDollars((c.balanceCents / 100).toFixed(2)); }}>Record payment</button>
                  <button className="mini" onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/i/${c.token}`)
                      .then(() => setFlash("Pay link copied — paste it anywhere."))
                      .catch(() => setFlash(`Pay link: ${window.location.origin}/i/${c.token}`));
                  }}>Copy pay link</button>
                  <button className="mini" disabled={busy} onClick={() => {
                    const reason = prompt("Void this invoice — what's the reason? (The number is burnt, not reused.)");
                    if (reason?.trim()) run(() => voidInvoiceAction({ invoiceId: c.invoiceId, estimateId, reason: reason.trim() }));
                  }}>Void</button>
                </>
              )}
              {!c.isDraft && (
                <a className="mini" href={`/invoicing/inv/${c.invoiceId}/pdf`} target="_blank" rel="noreferrer">PDF</a>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* ================= COSTS ================= */}
      <section className={`tab ${tab === "costs" ? "on" : ""}`}>
        <div className="card grp">
          <div className="row">
            <div className="k">Contractor</div>
            <span
              className={`chip ${costs.ci?.status === "paid" ? "paid" : costs.ci?.status === "approved" ? "approved" : costs.ci?.status === "submitted" ? "submitted" : "awaiting"}`}
              data-testid="ci-chip"
            >
              {costs.ci
                ? `${costs.ci.number ?? "Drafted"} · ${costs.ci.status}`
                : "Invoice at sign-off"}
            </span>
          </div>
          <div className="kv"><span>Offer (fixed)</span><b>{fmt2(costs.offerCents)}</b></div>
          <div className="kv"><span>Accepted variations</span><b>{costs.acceptedDeltaCents ? (costs.acceptedDeltaCents > 0 ? "+" : "−") + fmt2(Math.abs(costs.acceptedDeltaCents)) : "—"}</b></div>
          <div className="kv"><span>To pay after sign-off</span><b>{fmt2(costs.offerCents + costs.acceptedDeltaCents)}</b></div>
        </div>
        <div className="card grp" data-testid="materials-group">
          <div className="k" style={{ marginBottom: 4 }}>Materials</div>
          {(costs.materials ?? []).length === 0 && (
            <div className="hint">No material costs yet — supplier invoices land here from bills@ and the Airtable sync.</div>
          )}
          {(costs.materials ?? []).map((m) => (
            <div className="kv" key={m.id} data-testid={`material-${m.id}`}>
              <span>
                {m.label} <span className="chip draft" style={{ marginLeft: 6 }}>{m.sourceChip}</span>
              </span>
              <b>{m.docUrl ? <a href={m.docUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>doc →</a> : ""}</b>
            </div>
          ))}
        </div>

        <div className="card grp" data-testid="trades-group">
          <div className="k" style={{ marginBottom: 4 }}>Other trades &amp; costs</div>
          {(costs.rows ?? []).length === 0 && (
            <div className="hint">Nothing recorded — vendor invoices and dockets land here through the intake queue, or add one below.</div>
          )}
          {(costs.rows ?? []).map((r) => (
            <div className="kv" key={r.id} data-testid={`job-cost-item-${r.id}`}>
              <span>
                {r.vendor} · {r.ref}
                <span className="chip draft" style={{ marginLeft: 6 }}>{r.sourceChip}</span>
                {!r.linked && <span className="chip submitted" style={{ marginLeft: 4 }}>not in estimate</span>}
              </span>
              <b>
                {fmt2(r.amtCents)}
                {r.docUrl ? <> · <a href={r.docUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>doc →</a></> : null}
              </b>
            </div>
          ))}
          <div className="hint" style={{ marginTop: 8 }}>Est-vs-actual bars arrive with 6b.</div>
          {woId && (
            <button className="mini cy" style={{ marginTop: 10 }} onClick={() => setAddCost(true)} data-testid="add-cost-button">
              ＋ Add cost
            </button>
          )}
        </div>
      </section>

      <div className="note">every figure reads from the job ledger · lib/invoicing</div>

      {/* primary actions */}
      <div className="actions">
        <button className="btn ghost" onClick={() => { setSheet("request"); setMode("25"); }}>Request payment</button>
        <button className="btn primary" disabled={busy}
          onClick={() => { if (confirm("Draft a final invoice for the remaining balance?")) run(() => invoiceInFullAction({ estimateId })); }}>
          Invoice in full
        </button>
      </div>

      {/* sheets */}
      <SendInvoiceSheet
        open={sendFor !== null}
        verb="Issue & send"
        busy={busy}
        onClose={() => setSendFor(null)}
        onSend={({ message, via }) => {
          const invoiceId = sendFor!;
          run(() => issueAndSendAction({ invoiceId, estimateId, message, via }));
          setSendFor(null);
        }}
      />
      {woId && <AddCostSheet estimateId={estimateId} woId={woId} open={addCost} onClose={() => setAddCost(false)} />}
      <div className="scrim" onClick={() => setSheet(null)} style={sheet ? { opacity: 1, pointerEvents: "auto" } : undefined} />

      {/* request payment */}
      <div className="sheet" role="dialog" aria-label="Request a payment" style={sheet === "request" ? { transform: "none" } : undefined}>
        <h3>Request a payment</h3>
        <div className="hint">Drafts an invoice against the balance of <span className="mono">{fmt2(strip.balanceCents)}</span>. The amount is computed on the server — this sheet only sends the choice.</div>
        <div className="chips">
          {(["10", "25", "50"] as const).map((p) => (
            <button key={p} className={`pchip ${mode === p ? "on" : ""}`} onClick={() => setMode(p)}>{p}%</button>
          ))}
          <button className={`pchip ${mode === "custom" ? "on" : ""}`} onClick={() => setMode("custom")}>%…</button>
          <button className={`pchip ${mode === "fixed" ? "on" : ""}`} onClick={() => setMode("fixed")}>$ Fixed</button>
        </div>
        {mode === "custom" && (
          <input type="number" inputMode="decimal" min={1} max={100} placeholder="Percent of adjusted contract"
            value={customPct} onChange={(e) => setCustomPct(e.target.value)} />
        )}
        {mode === "fixed" && (
          <input type="number" inputMode="decimal" min={1} placeholder="Amount in dollars (inc GST)"
            value={fixedDollars} onChange={(e) => setFixedDollars(e.target.value)} />
        )}
        <div className="preview">
          <div className="k">Invoice preview</div>
          <div className="v" data-testid="request-preview">{previewCents != null ? fmt2(previewCents) : "—"}</div>
          <div className="g">
            {previewCents != null
              ? pct != null
                ? `${pct}% of adjusted contract ${fmt2(strip.adjustedCents)} · incl. GST ${fmt2(gstFromIncCents(previewCents))} · due 7 days from issue`
                : `Fixed amount — server-validated against the balance · incl. GST ${fmt2(gstFromIncCents(previewCents))}`
              : "Pick a percentage or enter an amount"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn ghost" onClick={() => setSheet(null)}>Cancel</button>
          <button className="btn primary" disabled={busy || previewCents == null}
            onClick={() => run(() =>
              requestPaymentAction(
                pct != null
                  ? { estimateId, mode: "percent", value: pct }
                  : { estimateId, mode: "fixed", value: Math.round(Number(fixedDollars) * 100) },
              ))}>
            Draft invoice
          </button>
        </div>
      </div>

      {/* record payment */}
      <div className="sheet" role="dialog" aria-label="Record a payment" style={sheet && sheet !== "request" ? { transform: "none" } : undefined}>
        {sheet && sheet !== "request" && (
          <>
            <h3>Record a payment</h3>
            <div className="hint">{sheet.record.num} · balance <span className="mono">{fmt2(sheet.record.balanceCents)}</span>. Bounded server-side — small overpayments only.</div>
            <div className="chips">
              {([["bank_transfer", "Bank"], ["cash", "Cash"], ["other", "Other"]] as const).map(([k, label]) => (
                <button key={k} className={`pchip ${payMethod === k ? "on" : ""}`} onClick={() => setPayMethod(k)}>{label}</button>
              ))}
            </div>
            <input type="number" inputMode="decimal" min={0.01} step="0.01" placeholder="Amount received (dollars)"
              value={payDollars} onChange={(e) => setPayDollars(e.target.value)} data-testid="record-amount" />
            <input type="text" placeholder="Reference (optional)" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setSheet(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !(Number(payDollars) > 0)}
                onClick={() => run(() => recordPaymentAction({
                  invoiceId: sheet.record.invoiceId, estimateId, method: payMethod,
                  amountCents: Math.round(Number(payDollars) * 100), reference: payRef,
                }))}>
                Record {Number(payDollars) > 0 ? fmtSigned2(Math.round(Number(payDollars) * 100)) : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
