"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsAsInput, depositPreview, parseDollarsToCents } from "@/lib/invoicing/jobMoney";
import { requestPreviewCents } from "@/lib/invoicing/derive";
import {
  changeDepositAction, deleteDraftAction, invoiceInFullAction, pauseRemindersAction, requestPaymentAction, setDraftDueAction, voidInvoiceAction,
  redraftFinalAction,
} from "../actions";
import AddCostSheet from "../job/[estimateId]/AddCostSheet";
import { DepositAdjust, usePaymentsUi, type ActionSpec } from "./ActionsClient";
import { fmt2 } from "../format";

/**
 * The job panel's buttons (payments-merge brief §4.7, Step 7). Every write is
 * an existing server action over a definer RPC; every figure shown is the
 * server's or a lib/invoicing preview.
 */

export type CardSpec = {
  invoiceId: string; estimateId: string; status: string; state: string; isDeposit: boolean; kindIsDeposit: boolean;
  balanceCents: number; dueOn: string | null; chaseHold: string | null; token?: string;
  /** The row's spec, re-aimed at THIS invoice (send / pay act on it). */
  spec: ActionSpec;
};

export function InvoiceCardActions({ c, today }: { c: CardSpec; today: string }) {
  const ui = usePaymentsUi();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const [changing, setChanging] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) setErr(r.message ?? "That didn't work."); else { setErr(""); router.refresh(); }
  });
  const open = <Link className="b" href={`/invoicing/inv/${c.invoiceId}`}>{c.status === "draft" ? "Check invoice" : "Open invoice"}</Link>;

  if (c.status === "draft") {
    return (
      <>
        {c.isDeposit && c.kindIsDeposit && c.spec.depositDraft ? <div className="inset"><DepositAdjust spec={c.spec} inSheet /></div> : null}
        <div className="due">
          <label htmlFor={`due-${c.invoiceId}`}>Due date<small>Change it any time before sending</small></label>
          <input type="date" id={`due-${c.invoiceId}`} defaultValue={c.dueOn ?? ""} min={today} disabled={busy}
            onChange={(e) => { const v = e.target.value; if (v) run(() => setDraftDueAction({ invoiceId: c.invoiceId, estimateId: c.estimateId, dueOn: v })); }} />
        </div>
        {err ? <div className="err">{err}</div> : null}
        <div className="acts">
          {open}
          <button type="button" className="b" disabled={busy} onClick={() => { if (window.confirm("Delete this draft? Only an invoice that has not been sent can be deleted.")) run(() => deleteDraftAction({ invoiceId: c.invoiceId, estimateId: c.estimateId })); }}>Delete draft</button>
          <button type="button" className="b" disabled={ui.busy} onClick={() => ui.openPay(c.spec, c.invoiceId)}>Already paid</button>
          <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.openSend(c.spec)}>Send</button>
        </div>
      </>
    );
  }
  if (c.state === "void" || c.balanceCents <= 0) return <div className="acts">{open}</div>;
  return (
    <>
      {changing ? <ChangeAmount c={c} onDone={() => { setChanging(false); router.refresh(); }} /> : null}
      {err ? <div className="err">{err}</div> : null}
      <div className="acts">
        {c.kindIsDeposit ? <button type="button" className="b" onClick={() => setChanging((v) => !v)}>Change amount</button> : null}
        <button type="button" className="b" disabled={busy} title={c.chaseHold ?? undefined} data-testid={c.chaseHold ? "resume-reminders" : "pause-reminders"}
          onClick={() => {
            if (c.chaseHold) { run(() => pauseRemindersAction({ invoiceId: c.invoiceId, estimateId: c.estimateId, reason: "" })); return; }
            const reason = window.prompt("Pause the payment reminders — why? (A dispute, a payment plan…)");
            if (reason?.trim()) run(() => pauseRemindersAction({ invoiceId: c.invoiceId, estimateId: c.estimateId, reason: reason.trim() }));
          }}>{c.chaseHold ? "Resume reminders" : "Pause reminders"}</button>
        <button type="button" className="b" disabled={busy}
          onClick={() => { const reason = window.prompt("Void this invoice — what's the reason? (The number is burnt, not reused.)"); if (reason?.trim()) run(() => voidInvoiceAction({ invoiceId: c.invoiceId, estimateId: c.estimateId, reason: reason.trim() })); }}>Void</button>
        {open}
        <button type="button" className="b" disabled={ui.busy} onClick={() => ui.openPay(c.spec, c.invoiceId)}>Cash or part</button>
        <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.quickPay(c.spec)}>✓ Paid {fmt2(c.balanceCents)}</button>
      </div>
    </>
  );
}

/** Change amount on a SENT, unpaid deposit (⚑P6): void and reissue in one transaction, then the corrected one is sent. */
function ChangeAmount({ c, onDone }: { c: CardSpec; onDone: () => void }) {
  const ui = usePaymentsUi();
  const [busy, start] = useTransition();
  const [text, setText] = useState(centsAsInput(c.balanceCents));
  const [msg, setMsg] = useState("");
  const go = (pick: { pct: number } | { cents: number }) => {
    if (!window.confirm(`Cancel this deposit invoice and send ${c.spec.first} a corrected one?`)) return;
    start(async () => {
      const r = await changeDepositAction({ invoiceId: c.invoiceId, estimateId: c.estimateId, mode: "pct" in pick ? "percent" : "fixed", value: "pct" in pick ? pick.pct : pick.cents });
      if (!r.ok) { setMsg(r.message ?? "That didn't work."); return; }
      onDone();
    });
  };
  const now = depositPreview(c.spec.contractCents, { cents: c.balanceCents });
  return (
    <div className="inset"><div className="adj">
      <div className="row">
        {ui.settings.depositOptionsPct.map((p) => <button key={p} type="button" className={`pc${Math.abs(now.pctOfContract - p) < 0.05 ? " on" : ""}`} disabled={busy} onClick={() => go({ pct: p })}>{p}%</button>)}
        <label className="cust-amt"><span className="mono">$</span>
          <input inputMode="decimal" aria-label="New deposit amount" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { const cents = parseDollarsToCents(text); if (cents) go({ cents }); } }} /></label>
      </div>
      <p className="warn">This one is already sent. Changing it cancels it and sends {c.spec.first} a corrected invoice.</p>
      {msg ? <p className="err">{msg}</p> : null}
    </div></div>
  );
}

/** Request a payment · Invoice in full · Revise scope — unchanged in what they do (§4.7). */
export function MoneyInLinks({ estimateId, contractCents }: { estimateId: string; contractCents: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("25");
  const [msg, setMsg] = useState("");
  const pct = Number(value);
  const cents = mode === "fixed" ? parseDollarsToCents(value) : null;
  const preview = mode === "percent" && pct > 0 && pct <= 100 ? requestPreviewCents(contractCents, pct) : cents;
  return (
    <>
      <div className="links">
        <button type="button" onClick={() => setOpen(true)}>Request a payment</button>
        <button type="button" disabled={busy} onClick={() => start(async () => { const r = await invoiceInFullAction({ estimateId }); setMsg(r.message ?? ""); if (r.ok) router.refresh(); })}>Invoice in full</button>
        <Link href={`/quote?id=${estimateId}&mode=revision`} data-testid="revision-builder-link">Revise scope</Link>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
      {open ? (
        <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sheet" role="dialog" aria-label="Request a payment">
            <h3>Request a payment</h3>
            <div className="who">A share of the job or a fixed amount. It is drafted for you to check and send.</div>
            <div className="field"><label>How much?</label>
              <div className="methods">
                {[10, 25, 50].map((p) => <button key={p} type="button" className={mode === "percent" && pct === p ? "on" : undefined} onClick={() => { setMode("percent"); setValue(String(p)); }}>{p}%</button>)}
              </div></div>
            <div className="two">
              <div className="field"><label htmlFor="rqPct">Percent</label><input id="rqPct" inputMode="decimal" value={mode === "percent" ? value : ""} onChange={(e) => { setMode("percent"); setValue(e.target.value); }} /></div>
              <div className="field"><label htmlFor="rqAmt">Or an amount ($)</label><input id="rqAmt" className="money" inputMode="decimal" value={mode === "fixed" ? value : ""} onChange={(e) => { setMode("fixed"); setValue(e.target.value); }} /></div>
            </div>
            <div className="hint">{preview ? <>Drafts an invoice for <span data-testid="request-preview">{fmt2(preview)}</span>.</> : "Enter a percentage or an amount."}</div>
            <button type="button" className="b pri wide" disabled={busy || !preview}
              onClick={() => start(async () => {
                const r = await requestPaymentAction({ estimateId, mode, value: mode === "percent" ? pct : cents ?? 0 });
                if (!r.ok) { setMsg(r.message ?? ""); return; }
                setOpen(false); router.refresh();
              })}>Draft the invoice</button>
            <button type="button" className="cancel" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AddCostButton({ estimateId, woId, startOpen = false }: { estimateId: string; woId: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" className="b" onClick={() => setOpen(true)} data-testid="add-cost-button">Add a cost</button>
      <AddCostSheet estimateId={estimateId} woId={woId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function OpenChatButton({ spec }: { spec: ActionSpec }) {
  const ui = usePaymentsUi();
  return <button type="button" className="b sm" disabled={ui.busy} onClick={() => ui.message(spec)}>Open chat</button>;
}

/** §6.3: work a stale draft final out again from what is left to invoice. */
export function RedraftFinal({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  return <>
    <button type="button" className="b sm pri" disabled={busy} onClick={() => start(async () => {
      const r = await redraftFinalAction({ estimateId });
      if (!r.ok) setErr(r.message ?? "That didn't work."); else router.refresh();
    })}>Redraft</button>
    {err ? <span className="err"> {err}</span> : null}
  </>;
}
