"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsAsInput, depositPreview, parseDollarsToCents } from "@/lib/invoicing/jobMoney";
import {
  approveCiQuickAction, createDepositAction, invoiceInFullAction, payCiQuickAction, paymentMessageDraftAction, quickPayAction, recordPaymentAction,
  sendWithDueAction, setDepositAction, unapproveCiAction, undoPaymentAction, unpayCiAction,
} from "../actions";
import { openEstimateChat } from "@/app/components/staffDockBus";
import { fmt2 } from "../format";

/**
 * Payments merge Step 3 — the quick actions (brief §4.3), built to the
 * mockup's sheets and toast. Every figure shown here arrives from the server
 * (the row) or from lib/invoicing previews; every write is a server action
 * over a definer RPC that recomputes and bounds what it stores.
 */

export type PayTarget = { invoiceId: string; label: string; balanceCents: number; draft: boolean };

/** Everything a row's buttons need, decided on the server from the JobMoneyRow. */
export type ActionSpec = {
  estimateId: string;
  address: string;
  customer: string;
  first: string;
  jobHref: string;
  contractCents: number;
  startDate: string | null;
  startText: string;
  primary:
    | { kind: "pay"; invoiceId: string; balanceCents: number }
    | { kind: "send"; invoiceId: string; kindName: string; balanceCents: number; suggestedDueOn: string | null; isDeposit: boolean }
    | { kind: "create_deposit" }
    | { kind: "create_final"; uninvoicedCents: number }
    | { kind: "open" };
  /** Unpaid invoices on the job, worst first — the "Payment for" list. */
  payable: PayTarget[];
  /** The draft deposit the adjuster changes, when there is one. */
  depositDraft: { invoiceId: string; totalCents: number } | null;
  /** The invoice Message chases (§4.4) — the row's next one; null when nothing is owing. */
  messageInvoiceId: string | null;
};

export type PaymentsUiSettings = { depositOptionsPct: number[]; notifyPaymentDefault: boolean; today: string };

/** What a toast's Undo (and, for a customer payment, Change) does. */
type UndoSpec =
  | { kind: "payment"; paymentId: string; spec: ActionSpec; invoiceId: string }
  | { kind: "ci"; ids: string[]; was: "approve" | "pay" };
type Toast = { msg: string; undo?: UndoSpec; until: number } | null;
type Sheet = { kind: "pay"; spec: ActionSpec; invoiceId: string } | { kind: "send"; spec: ActionSpec } | null;

type Ui = {
  settings: PaymentsUiSettings;
  busy: boolean;
  openPay: (spec: ActionSpec, invoiceId?: string) => void;
  openSend: (spec: ActionSpec) => void;
  quickPay: (spec: ActionSpec) => void;
  create: (spec: ActionSpec) => void;
  adjustOpen: (estimateId: string) => boolean;
  toggleAdjust: (estimateId: string) => void;
  setDeposit: (spec: ActionSpec, pick: { pct: number } | { cents: number }) => void;
  message: (spec: ActionSpec) => void;
  /** Contractors (Step 5): one press, one or many invoices, with Undo. `say` is the toast line. */
  approveCi: (ids: string[], say: string) => void;
  payCi: (ids: string[], say: string) => void;
};

const Ctx = createContext<Ui | null>(null);
const useUi = () => {
  const ui = useContext(Ctx);
  if (!ui) throw new Error("Payments actions used outside PaymentsUiProvider");
  return ui;
};

export function PaymentsUiProvider({ settings, children }: { settings: PaymentsUiSettings; children: React.ReactNode }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<Toast>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [adjust, setAdjust] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: NonNullable<Toast>) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), Math.max(0, t.until - Date.now()));
  }, []);
  const say = useCallback((msg: string) => show({ msg, until: Date.now() + 4200 }), [show]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const done = useCallback((r: { ok: boolean; message?: string }, ok?: string) => {
    say(r.ok ? ok ?? r.message ?? "Done." : r.message ?? "That didn't work.");
    if (r.ok) router.refresh();
  }, [router, say]);

  const ui = useMemo<Ui>(() => ({
    settings, busy,
    openPay: (spec, invoiceId) => setSheet({ kind: "pay", spec, invoiceId: invoiceId ?? spec.payable[0]?.invoiceId ?? "" }),
    openSend: (spec) => setSheet({ kind: "send", spec }),
    quickPay: (spec) => {
      if (spec.primary.kind !== "pay") return;
      const { invoiceId, balanceCents } = spec.primary;
      start(async () => {
        const r = await quickPayAction({ invoiceId, estimateId: spec.estimateId });
        if (!r.ok || !r.id) { done(r); return; }
        router.refresh();
        const secs = r.undoSeconds ?? 8;
        show({ msg: `Recorded ${fmt2(balanceCents)} from ${spec.first}, bank transfer, today.`, undo: { kind: "payment", paymentId: r.id, spec, invoiceId }, until: Date.now() + secs * 1000 });
      });
    },
    create: (spec) => start(async () => {
      if (spec.primary.kind === "create_deposit") done(await createDepositAction({ estimateId: spec.estimateId }));
      else if (spec.primary.kind === "create_final") done(await invoiceInFullAction({ estimateId: spec.estimateId }));
    }),
    adjustOpen: (id) => adjust.has(id),
    toggleAdjust: (id) => setAdjust((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setDeposit: (spec, pick) => {
      if (!spec.depositDraft) return;
      const { invoiceId } = spec.depositDraft;
      start(async () => done(await setDepositAction({
        invoiceId, estimateId: spec.estimateId,
        mode: "pct" in pick ? "percent" : "fixed", value: "pct" in pick ? pick.pct : pick.cents,
      })));
    },
    // Message (§4.4): the server writes the draft and the pay link; the dock shows it; a person sends it.
    approveCi: (ids, line) => start(async () => {
      const r = await approveCiQuickAction({ ids });
      if (!r.ok) { say(r.message); return; }
      router.refresh();
      show({ msg: r.done.length === ids.length ? line : r.message, undo: { kind: "ci", ids: r.done, was: "approve" }, until: Date.now() + (r.undoSeconds ?? 8) * 1000 });
    }),
    payCi: (ids, line) => start(async () => {
      const r = await payCiQuickAction({ ids });
      if (!r.ok) { say(r.message); return; }
      router.refresh();
      show({ msg: r.done.length === ids.length ? line : r.message, undo: { kind: "ci", ids: r.done, was: "pay" }, until: Date.now() + (r.undoSeconds ?? 8) * 1000 });
    }),
    message: (spec) => start(async () => {
      const d = await paymentMessageDraftAction(spec.messageInvoiceId ? { estimateId: spec.estimateId, invoiceId: spec.messageInvoiceId } : { estimateId: spec.estimateId });
      if (!d.ok) { say(d.message); return; }
      openEstimateChat({ estimateId: d.estimateId, who: d.who, phone: d.phone, accountId: d.accountId, invoiceId: d.invoiceId, presets: d.presets, selected: d.selected });
    }),
  }), [settings, busy, adjust, done, router, say, show, start]);

  const undo = (change: boolean) => {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    start(async () => {
      if (u.kind === "ci") {
        const r = u.was === "approve" ? await unapproveCiAction({ ids: u.ids }) : await unpayCiAction({ ids: u.ids });
        router.refresh();
        say(r.ok ? "Undone." : r.message);
        return;
      }
      const r = await undoPaymentAction({ paymentId: u.paymentId, estimateId: u.spec.estimateId });
      if (!r.ok) { say(r.message ?? "That couldn't be undone."); return; }
      router.refresh();
      if (change) setSheet({ kind: "pay", spec: u.spec, invoiceId: u.invoiceId });
      else say("Undone.");
    });
  };

  return (
    <Ctx.Provider value={ui}>
      {children}
      {sheet?.kind === "pay" ? <PaySheet spec={sheet.spec} invoiceId={sheet.invoiceId} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === "send" ? <SendSheet spec={sheet.spec} onClose={() => setSheet(null)} onDone={done} /> : null}
      <div className={`toast${toast ? " on" : ""}`} role="status" data-testid="pm-toast">
        {toast ? <span>{toast.msg}</span> : null}
        {toast?.undo ? <button type="button" onClick={() => undo(false)} disabled={busy}>Undo</button> : null}
        {toast?.undo?.kind === "payment" ? <button type="button" onClick={() => undo(true)} disabled={busy}>Change</button> : null}
      </div>
    </Ctx.Provider>
  );
}

// ---- the row's buttons -------------------------------------------------------------

export function RowActions({ spec, small = false }: { spec: ActionSpec; small?: boolean }) {
  const ui = useUi();
  const cls = small ? "b sm" : "b";
  const message = <button type="button" className={cls} disabled={ui.busy} onClick={() => ui.message(spec)}>Message</button>;
  const p = spec.primary;
  if (p.kind === "open") return small ? null : <><Link className={cls} href={spec.jobHref}>Open job</Link>{message}</>;
  if (p.kind === "create_deposit" || p.kind === "create_final") {
    if (small) return null;
    return <><button type="button" className={`${cls} pri`} disabled={ui.busy} onClick={() => ui.create(spec)}>
      {p.kind === "create_deposit" ? "Create deposit invoice" : `Create final invoice ${fmt2(p.uninvoicedCents)}`}</button>{message}</>;
  }
  if (p.kind === "pay") {
    return <>
      <button type="button" className={`${cls} pri`} disabled={ui.busy} onClick={() => ui.quickPay(spec)}>✓ Paid{small ? "" : ` ${fmt2(p.balanceCents)}`}</button>
      {small ? null : <button type="button" className={cls} disabled={ui.busy} onClick={() => ui.openPay(spec, p.invoiceId)}>Cash or part</button>}
      {message}
    </>;
  }
  return <>
    <button type="button" className={`${cls} pri`} disabled={ui.busy} onClick={() => ui.openSend(spec)}>Send{small ? "" : ` ${p.kindName.toLowerCase()} ${fmt2(p.balanceCents)}`}</button>
    {small ? null : <button type="button" className={cls} disabled={ui.busy} onClick={() => ui.openPay(spec, p.invoiceId)}>Already paid</button>}
    {message}
  </>;
}

/** The pill's "change" — opens the deposit adjuster under the pills. */
export function AdjustButton({ estimateId }: { estimateId: string }) {
  const ui = useUi();
  return <button type="button" className="edit" aria-expanded={ui.adjustOpen(estimateId)} onClick={() => ui.toggleAdjust(estimateId)}>change</button>;
}

/** The adjuster: 10 / 20 / 30 / 50 % (Settings, ⚑P5) or a dollar amount. The server computes the cents. */
export function DepositAdjust({ spec, inSheet = false }: { spec: ActionSpec; inSheet?: boolean }) {
  const ui = useUi();
  const draft = spec.depositDraft;
  if (!draft || (!inSheet && !ui.adjustOpen(spec.estimateId))) return null;
  const now = depositPreview(spec.contractCents, { cents: draft.totalCents });
  return (
    <div className="adj">
      <div className="row">
        {ui.settings.depositOptionsPct.map((p) => (
          <button key={p} type="button" className={`pc${Math.abs(now.pctOfContract - p) < 0.05 ? " on" : ""}`} disabled={ui.busy}
            onClick={() => ui.setDeposit(spec, { pct: p })}>{p}%</button>
        ))}
        {/* Keyed by the stored figure: a server change resets the box. */}
        <AmountBox key={draft.totalCents} cents={draft.totalCents} onCommit={(cents) => ui.setDeposit(spec, { cents })} />
      </div>
      <p>Deposit <b>{fmt2(now.depositCents)}</b> ({now.pctOfContract}% of {fmt2(spec.contractCents)}). Leaves <b>{fmt2(now.leavesCents)}</b> for later.</p>
    </div>
  );
}

function AmountBox({ cents, onCommit }: { cents: number; onCommit: (cents: number) => void }) {
  const [text, setText] = useState(centsAsInput(cents));
  const commit = () => {
    const next = parseDollarsToCents(text);
    if (next && next !== cents) onCommit(next);
  };
  return (
    <label className="cust-amt"><span className="mono">$</span>
      <input inputMode="decimal" aria-label="Deposit amount" value={text} onChange={(e) => setText(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </label>
  );
}

// ---- the sheets --------------------------------------------------------------------

type Method = "bank_transfer" | "cash" | "other";
const METHOD_WORD: Record<Method, string> = { bank_transfer: "bank transfer", cash: "cash", other: "other" };

function PaySheet({ spec, invoiceId, onClose, onDone }: { spec: ActionSpec; invoiceId: string; onClose: () => void; onDone: (r: { ok: boolean; message?: string }, ok?: string) => void }) {
  const ui = useUi();
  const [forId, setForId] = useState(invoiceId);
  const target = spec.payable.find((t) => t.invoiceId === forId) ?? spec.payable[0];
  const [amount, setAmount] = useState(target ? centsAsInput(target.balanceCents) : "");
  const [date, setDate] = useState(ui.settings.today);
  const [method, setMethod] = useState<Method>("bank_transfer");
  const [notify, setNotify] = useState(ui.settings.notifyPaymentDefault);
  const [err, setErr] = useState("");
  if (!target) return null;

  const pick = (id: string) => {
    setForId(id);
    const t = spec.payable.find((x) => x.invoiceId === id);
    if (t) setAmount(centsAsInput(t.balanceCents));
  };
  const save = () => {
    const cents = parseDollarsToCents(amount);
    if (!cents) { setErr("Enter the amount received."); return; }
    if (cents > target.balanceCents) { setErr(`That is more than the ${fmt2(target.balanceCents)} owing on this invoice.`); return; }
    setErr("");
    const sendsEmail = method !== "cash" || notify;
    void (async () => {
      const r = await recordPaymentAction({
        invoiceId: target.invoiceId, estimateId: spec.estimateId, method, amountCents: cents, receivedOn: date, notify: sendsEmail,
      });
      if (!r.ok) { setErr(r.message ?? "That didn't save."); return; }
      onClose();
      let m = `Recorded ${fmt2(cents)} from ${spec.first}, ${METHOD_WORD[method]}.`;
      if (method === "cash") m += (target.draft && cents >= target.balanceCents ? " Invoice not sent." : "") + (notify ? ` Confirmation emailed to ${spec.first}.` : " No email sent.");
      if (cents < target.balanceCents) m += " Part paid — the rest is still owing.";
      onDone(r, m);
    })();
  };

  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="payT">
        <h3 id="payT">Record a payment</h3>
        <div className="who">{spec.address} · {spec.customer}</div>
        <div className="field"><label htmlFor="pFor">Payment for</label>
          <select id="pFor" value={target.invoiceId} onChange={(e) => pick(e.target.value)}>
            {spec.payable.map((t) => <option key={t.invoiceId} value={t.invoiceId}>{t.label}</option>)}
          </select></div>
        <div className="two">
          <div className="field"><label htmlFor="pAmt">Amount received</label><input id="pAmt" className="money" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label htmlFor="pDate">Date received</label><input id="pDate" type="date" value={date} max={ui.settings.today} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>How was it paid?</label>
          <div className="methods">
            {(["bank_transfer", "cash", "other"] as Method[]).map((m) => (
              <button key={m} type="button" className={method === m ? "on" : undefined} onClick={() => setMethod(m)}>{m === "bank_transfer" ? "Bank" : m === "cash" ? "Cash" : "Other"}</button>
            ))}
          </div></div>
        <div className={`cashbox${method === "cash" ? " on" : ""}`}>
          <p>{target.draft
            ? <><b>Cash.</b> The invoice will <b>not be sent</b> to {spec.first}. The payment is still recorded against the job.</>
            : <><b>Cash.</b> This invoice has already gone to {spec.first}. Nothing else is sent unless the switch below is on.</>}</p>
          <div className="tog"><span>Send notification of payment<small>Emails the customer to confirm we received their cash</small></span>
            <button type="button" className="switch" role="switch" aria-checked={notify} aria-label="Send notification of payment" onClick={() => setNotify((n) => !n)} /></div>
        </div>
        {method !== "cash" ? <div className="hint">{target.draft ? "The invoice is marked paid without being sent. A receipt is emailed to the customer." : "A receipt is emailed to the customer."}</div> : null}
        <div className="err">{err}</div>
        <button type="button" className="b pri wide" disabled={ui.busy} onClick={save}>Record payment</button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function SendSheet({ spec, onClose, onDone }: { spec: ActionSpec; onClose: () => void; onDone: (r: { ok: boolean; message?: string }, ok?: string) => void }) {
  const ui = useUi();
  const p = spec.primary.kind === "send" ? spec.primary : null;
  const [due, setDue] = useState(p?.suggestedDueOn ?? ui.settings.today);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  if (!p) return null;
  // Date strings compare as calendar days; a deposit due on or after the start is the warning (§4.3).
  const late = p.isDeposit && !!spec.startDate && due >= spec.startDate;
  const send = () => {
    setSending(true);
    void (async () => {
      const r = await sendWithDueAction({ invoiceId: p.invoiceId, estimateId: spec.estimateId, dueOn: due });
      setSending(false);
      if (!r.ok) { setErr(r.message ?? "That didn't send."); return; }
      onClose();
      onDone(r);
    })();
  };
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="sendT">
        <h3 id="sendT">Send {p.kindName.toLowerCase()} invoice</h3>
        <div className="who">{spec.address} · to {spec.customer}</div>
        {p.isDeposit && spec.depositDraft ? <DepositAdjust spec={spec} inSheet /> : <div className="adj"><p style={{ margin: 0 }}>{p.kindName} invoice <b>{fmt2(p.balanceCents)}</b></p></div>}
        <div className="field"><label htmlFor="sDue">Due date</label><input id="sDue" type="date" value={due} min={ui.settings.today} onChange={(e) => setDue(e.target.value)} /></div>
        <div className={`hint${late ? " warn" : ""}`}>{late ? `${spec.startText}, so this due date falls on or after the start.` : `Emails the invoice and pay link to ${spec.first}. The due date locks once sent.`}</div>
        <div className="err">{err}</div>
        <button type="button" className="b pri wide" disabled={sending || ui.busy} onClick={send}>Send {fmt2(p.balanceCents)} invoice to {spec.first}</button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---- Contractors (Step 5) -----------------------------------------------------------

/** Approve / ✓ Paid on one contractor invoice row; the words are decided on the server. */
export function CiButtons({ id, status, approveLine, payLine, payLabel }: { id: string; status: string; approveLine: string; payLine: string; payLabel: string }) {
  const ui = useUi();
  if (status === "submitted") return <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.approveCi([id], approveLine)}>Approve</button>;
  if (status === "approved") return <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.payCi([id], payLine)}>{payLabel}</button>;
  return null;
}

/** "By contractor": Approve all N, and one ✓ Paid for everything approved. */
export function CiGroupButtons({ approveIds, payIds, approveLine, payLine, payLabel }: { approveIds: string[]; payIds: string[]; approveLine: string; payLine: string; payLabel: string }) {
  const ui = useUi();
  return <>
    {approveIds.length > 1 ? <button type="button" className="b" disabled={ui.busy} onClick={() => ui.approveCi(approveIds, approveLine)}>Approve all {approveIds.length}</button> : null}
    {payIds.length ? <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.payCi(payIds, payLine)}>{payLabel}</button> : null}
  </>;
}
