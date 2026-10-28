"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { centsAsInput, depositPreview, parseDollarsToCents } from "@/lib/invoicing/jobMoney";
import { gstFromIncCents } from "@/lib/invoicing/gst";
import {
  approveCiQuickAction, approveMaterialsAction, confirmMaterialsAction, createDepositAction, deleteMaterialAction, invoiceInFullAction,
  materialDocAction, notForJobAction, payCiQuickAction, paySupplierAction, paymentMessageDraftAction, quickPayAction, recordPaymentAction,
  restoreMaterialAction, sendWithDueAction, confirmCostAction, assignMaterialCostAction, holdFastTermsAction, releaseFastTermsAction, decideExpenseAction, decidePreapprovalAction, markReimbursedAction, setDepositAction, unapproveCiAction, undoPaymentAction, unpayCiAction, unpaySupplierAction,
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

/** A job the picker offers (Other job, Pick a job, Snap a receipt). */
export type PickJob = { estimateId: string; workOrderId: string; address: string; customer: string | null; laneName: string; priceLabel: string };

/** A Materials row as its buttons, View and the picker need it — figures decided on the server. */
export type MatSpec = {
  kind: "intake" | "cost"; id: string; state: "check" | "dup" | "rec" | "appr" | "paid" | "del";
  supplier: string; invoiceNo: string | null; invoiceDate: string | null; reference: string | null;
  jobAddress: string | null; amountLabel: string; unread: boolean; hasDoc: boolean;
  /** 8c: the reading and the job found, to prefill "Record as a cost…". */
  amountCents?: number; invoiceDateIso?: string | null; workOrderId?: string | null;
};

/** What a toast's Undo (and, for a customer payment, Change) does. */
type UndoSpec =
  | { kind: "payment"; paymentId: string; spec: ActionSpec; invoiceId: string }
  | { kind: "ci"; ids: string[]; was: "approve" | "pay" }
  | { kind: "mat_pay"; ids: string[] }
  | { kind: "mat_delete"; row: MatSpec };
type Toast = { msg: string; undo?: UndoSpec; until: number } | null;
type Sheet =
  | { kind: "pay"; spec: ActionSpec; invoiceId: string } | { kind: "send"; spec: ActionSpec }
  | { kind: "pick"; row: MatSpec | null } | { kind: "doc"; row: MatSpec } | { kind: "cost"; row: MatSpec }
  | { kind: "assign"; row: { id: string; supplier: string; amountLabel: string; reference: string | null } }
  | null;

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
  payCi: (ids: string[], say: string, details?: { reference: string; paidOn: string }) => void;
  /** Materials (Step 6). */
  confirmMat: (ids: string[], line: string, workOrderId?: string) => void;
  notForJob: (row: MatSpec) => void;
  deleteMat: (row: MatSpec) => void;
  restoreMat: (row: MatSpec) => void;
  approveMat: (ids: string[], line: string) => void;
  paySupplier: (ids: string[], line: string) => void;
  pick: (row: MatSpec | null) => void;
  record: (row: MatSpec) => void;
  assign: (row: { id: string; supplier: string; amountLabel: string; reference: string | null }) => void;
  view: (row: MatSpec) => void;
};

const Ctx = createContext<Ui | null>(null);
/** For the job panel's own client parts (PanelClient.tsx). */
export const usePaymentsUi = () => useUi();
const useUi = () => {
  const ui = useContext(Ctx);
  if (!ui) throw new Error("Payments actions used outside PaymentsUiProvider");
  return ui;
};

export function PaymentsUiProvider({ settings, jobs = [], children }: { settings: PaymentsUiSettings; jobs?: PickJob[]; children: React.ReactNode }) {
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
    payCi: (ids, line, details) => start(async () => {
      const r = await payCiQuickAction(details ? { ids, ...details } : { ids });
      if (!r.ok) { say(r.message); return; }
      router.refresh();
      show({ msg: r.done.length === ids.length ? line : r.message, undo: { kind: "ci", ids: r.done, was: "pay" }, until: Date.now() + (r.undoSeconds ?? 8) * 1000 });
    }),
    confirmMat: (ids, line, workOrderId) => start(async () => { setSheet(null); done(await confirmMaterialsAction(workOrderId ? { ids, workOrderId } : { ids }), line); }),
    notForJob: (row) => start(async () => { setSheet(null); done(await notForJobAction({ id: row.id }), `${row.supplier} ${row.amountLabel} marked as not for a job.`); }),
    deleteMat: (row) => start(async () => {
      setSheet(null);
      const r = await deleteMaterialAction({ kind: row.kind, id: row.id });
      if (!r.ok) { say(r.message); return; }
      router.refresh();
      show({ msg: `${row.supplier} ${row.amountLabel} deleted. It no longer counts anywhere.`, undo: { kind: "mat_delete", row }, until: Date.now() + 8000 });
    }),
    restoreMat: (row) => start(async () => done(await restoreMaterialAction({ kind: row.kind, id: row.id }), `${row.supplier} ${row.amountLabel} restored.`)),
    approveMat: (ids, line) => start(async () => { setSheet(null); done(await approveMaterialsAction({ ids }), line); }),
    paySupplier: (ids, line) => start(async () => {
      const r = await paySupplierAction({ ids });
      if (!r.ok) { say(r.message); return; }
      router.refresh();
      show({ msg: line, undo: { kind: "mat_pay", ids }, until: Date.now() + (r.undoSeconds ?? 8) * 1000 });
    }),
    pick: (row) => setSheet({ kind: "pick", row }),
    record: (row) => setSheet({ kind: "cost", row }),
    assign: (row) => setSheet({ kind: "assign", row }),
    view: (row) => setSheet({ kind: "doc", row }),
    message: (spec) => start(async () => {
      const d = await paymentMessageDraftAction(spec.messageInvoiceId ? { estimateId: spec.estimateId, invoiceId: spec.messageInvoiceId } : { estimateId: spec.estimateId });
      if (!d.ok) { say(d.message); return; }
      openEstimateChat({ estimateId: d.estimateId, who: d.who, phone: d.phone, accountId: d.accountId, invoiceId: d.invoiceId, presets: d.presets, selected: d.selected });
    }),
  }), [settings, busy, adjust, done, router, say, show, start]);

  const goSnap = (job: PickJob) => { setSheet(null); router.push(`/invoicing/job/${job.estimateId}?addcost=1&from=${encodeURIComponent("/invoicing?tab=mat")}`); };

  const undo = (change: boolean) => {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    start(async () => {
      if (u.kind === "mat_pay") {
        const r = await unpaySupplierAction({ ids: u.ids });
        router.refresh();
        say(r.ok ? "Undone." : r.message);
        return;
      }
      if (u.kind === "mat_delete") {
        const r = await restoreMaterialAction({ kind: u.row.kind, id: u.row.id });
        router.refresh();
        say(r.ok ? "Restored." : r.message);
        return;
      }
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
      {sheet?.kind === "pick" ? <PickSheet row={sheet.row} jobs={jobs} onClose={() => setSheet(null)} onPick={(job) => sheet.row ? ui.confirmMat([sheet.row.id], `${sheet.row.supplier} ${sheet.row.amountLabel} confirmed to ${job.address.split(",")[0]}.`, job.workOrderId) : goSnap(job)} /> : null}
      {sheet?.kind === "doc" ? <DocSheet row={sheet.row} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "assign" ? <PickSheet row={null} heading={{ title: "Which job is this for?", who: `${sheet.row.supplier} · ${sheet.row.amountLabel}${sheet.row.reference ? ` · supplier wrote “${sheet.row.reference}”` : ""}` }}
        jobs={jobs} onClose={() => setSheet(null)}
        onPick={(job) => start(async () => { const row = sheet.row; setSheet(null); done(await assignMaterialCostAction({ materialCostId: row.id, woId: job.workOrderId }), `${row.supplier} ${row.amountLabel} is now on ${job.address.split(",")[0]}.`); })} /> : null}
      {sheet?.kind === "cost" ? <CostSheet row={sheet.row} jobs={jobs} onClose={() => setSheet(null)} onDone={(r) => { if (r.ok) setSheet(null); done(r, r.message ?? ""); }} /> : null}
      <div className={`toast${toast ? " on" : ""}`} role="status" data-testid="pm-toast">
        {toast ? <span>{toast.msg}</span> : null}
        {toast?.undo ? <button type="button" onClick={() => undo(false)} disabled={busy}>Undo</button> : null}
        {toast?.undo?.kind === "payment" ? <button type="button" onClick={() => undo(true)} disabled={busy}>Change</button> : null}
      </div>
    </Ctx.Provider>
  );
}

// ---- the row's buttons -------------------------------------------------------------

/**
 * A job's address or "Open job" (Step 7): on the Payments page (/invoicing) it opens the
 * job panel over the current view (?job=, keeping the tab, filters and
 * search); anywhere else it goes to the job's own page.
 */
export function OpenJobLink({ estimateId, className, children }: { estimateId: string; className?: string; children: React.ReactNode }) {
  const path = usePathname();
  const sp = useSearchParams();
  let href = `/invoicing/job/${estimateId}`;
  if (path === "/invoicing") {
    const q = new URLSearchParams(sp.toString());
    q.set("job", estimateId);
    q.delete("jt");
    href = `${path}?${q.toString()}`;
  }
  return <Link className={className} href={href} scroll={false}>{children}</Link>;
}

export function RowActions({ spec, small = false }: { spec: ActionSpec; small?: boolean }) {
  const ui = useUi();
  const cls = small ? "b sm" : "b";
  const message = <button type="button" className={cls} disabled={ui.busy} onClick={() => ui.message(spec)}>Message</button>;
  const p = spec.primary;
  if (p.kind === "open") return small ? null : <><OpenJobLink className={cls} estimateId={spec.estimateId}>Open job</OpenJobLink>{message}</>;
  if (p.kind === "create_deposit" || p.kind === "create_final") {
    if (small) return null;
    return <><button type="button" className={`${cls} pri`} disabled={ui.busy} onClick={() => ui.create(spec)}>
      {p.kind === "create_deposit" ? "Create deposit invoice" : `Create final invoice ${fmt2(p.uninvoicedCents)}`}</button>{message}</>;
  }
  if (p.kind === "pay") {
    return <>
      <button type="button" className={`${cls} pri`} disabled={ui.busy} onClick={() => ui.quickPay(spec)}>One-click paid{small ? "" : ` ${fmt2(p.balanceCents)}`}</button>
      {small ? null : <button type="button" className={cls} disabled={ui.busy} onClick={() => ui.openPay(spec, p.invoiceId)}>Record a payment</button>}
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
  // Tom, 27 Oct: the invoice date is the day the work was billed — today unless changed,
  // any earlier day allowed, never a later one. The due date may be earlier than today too.
  const [issuedOn, setIssuedOn] = useState(ui.settings.today);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  if (!p) return null;
  // Date strings compare as calendar days; a deposit due on or after the start is the warning (§4.3).
  const late = p.isDeposit && !!spec.startDate && due >= spec.startDate;
  const send = () => {
    setSending(true);
    void (async () => {
      const r = await sendWithDueAction({ invoiceId: p.invoiceId, estimateId: spec.estimateId, dueOn: due, issuedOn });
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
        <div className="field"><label htmlFor="sIssued">Invoice date</label><input id="sIssued" type="date" value={issuedOn} max={ui.settings.today} onChange={(e) => setIssuedOn(e.target.value)} /></div>
        <div className="field"><label htmlFor="sDue">Due date</label><input id="sDue" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className={`hint${late ? " warn" : ""}`}>{late ? `${spec.startText}, so this due date falls on or after the start.` : `Emails the invoice and pay link to ${spec.first}. The due date locks once sent.`}</div>
        <div className="err">{err}</div>
        <button type="button" className="b pri wide" disabled={sending || ui.busy} onClick={send}>Send {fmt2(p.balanceCents)} invoice to {spec.first}</button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---- Contractors (Step 5) -----------------------------------------------------------

/** Approve / ✓ Paid on one contractor invoice row; the words are decided on the server. A draft RCTI is the office's to approve (8b). */
export function CiButtons({ id, status, rcti = false, approveLine, payLine, payLabel, withDetails = false }: {
  id: string; status: string; rcti?: boolean; approveLine: string; payLine: string; payLabel: string; withDetails?: boolean;
}) {
  const ui = useUi();
  const [details, setDetails] = useState(false);
  if (status === "submitted" || (status === "draft" && rcti)) return <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.approveCi([id], approveLine)}>Approve</button>;
  if (status === "approved") return <>
    <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.payCi([id], payLine)}>{payLabel}</button>
    {withDetails ? <button type="button" className="b" disabled={ui.busy} onClick={() => setDetails(true)}>Paid, with reference…</button> : null}
    {details ? <PaidDetailsSheet onClose={() => setDetails(false)} onSave={(d) => { setDetails(false); ui.payCi([id], payLine, d); }} /> : null}
  </>;
  return null;
}

/** The bank reference and the day it was paid (default today, never in the future) — the old Payables prompt, kept (8b). */
function PaidDetailsSheet({ onClose, onSave }: { onClose: () => void; onSave: (d: { reference: string; paidOn: string }) => void }) {
  const ui = useUi();
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(ui.settings.today);
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="ciPaidT">
        <h3 id="ciPaidT">Record the payment</h3>
        <div className="field"><label htmlFor="ciRef">Bank reference</label><input id="ciRef" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="field"><label htmlFor="ciPaidOn">Date paid</label><input id="ciPaidOn" type="date" value={paidOn} max={ui.settings.today} onChange={(e) => setPaidOn(e.target.value)} /></div>
        <div className="hint">The remittance goes to the contractor once the Undo has closed.</div>
        <button type="button" className="b pri wide" disabled={ui.busy || !paidOn} onClick={() => onSave({ reference: reference.trim(), paidOn })}>Mark paid</button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** "By contractor": Approve all N, and one ✓ Paid for everything approved. */
export function CiGroupButtons({ approveIds, payIds, approveLine, payLine, payLabel }: { approveIds: string[]; payIds: string[]; approveLine: string; payLine: string; payLabel: string }) {
  const ui = useUi();
  return <>
    {approveIds.length > 1 ? <button type="button" className="b" disabled={ui.busy} onClick={() => ui.approveCi(approveIds, approveLine)}>Approve all {approveIds.length}</button> : null}
    {payIds.length ? <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.payCi(payIds, payLine)}>{payLabel}</button> : null}
  </>;
}

// ---- Materials (Step 6) ----------------------------------------------------------------

/** A Materials row's buttons (§4.6), by its state. */
export function MatButtons({ row, inSheet = false }: { row: MatSpec; inSheet?: boolean }) {
  const ui = useUi();
  const del = <button type="button" className="b sm del" disabled={ui.busy} onClick={() => ui.deleteMat(row)}>Delete</button>;
  const view = !inSheet && row.hasDoc ? <button type="button" className="b sm" onClick={() => ui.view(row)}>View</button> : null;
  if (row.state === "del") return <><button type="button" className="b sm" disabled={ui.busy} onClick={() => ui.restoreMat(row)}>Restore</button>{view}</>;
  if (row.state === "check" || row.state === "dup") {
    // A possible duplicate (15 Oct): the same choices as a pending document — confirming it is the person's
    // decision, which cost_intake_confirm has always allowed — with Dismiss in place of Delete.
    const dup = row.state === "dup";
    const gone = dup ? <button type="button" className="b sm del" disabled={ui.busy} onClick={() => ui.deleteMat(row)}>Dismiss</button> : del;
    // 8c: any category, the figures typed when the reading failed — the old Payables confirm panel.
    const record = <button type="button" className={`b sm${row.unread ? " pri" : ""}`} disabled={ui.busy} onClick={() => ui.record(row)}>Record as a cost…</button>;
    return row.jobAddress && !row.unread
      ? <><button type="button" className={`b sm${dup ? "" : " pri"}`} disabled={ui.busy} onClick={() => ui.confirmMat([row.id], `${row.supplier} ${row.amountLabel} confirmed to ${row.jobAddress!.split(",")[0]}.`)}>Confirm</button>
          <button type="button" className="b sm" onClick={() => ui.pick(row)}>Other job</button>{record}{gone}{view}</>
      : row.unread ? <>{record}{gone}{view}</>
      : <><button type="button" className={`b sm${dup ? "" : " pri"}`} disabled={ui.busy} onClick={() => ui.pick(row)}>Pick a job</button>
          <button type="button" className="b sm" disabled={ui.busy} onClick={() => ui.notForJob(row)}>Not for a job</button>{record}{gone}{view}</>;
  }
  if (row.state === "rec") return <><button type="button" className="b sm pri" disabled={ui.busy} onClick={() => ui.approveMat([row.id], `${row.supplier} ${row.amountLabel} approved.`)}>Approve</button>{del}{view}</>;
  return view;
}

export function MatBulkButton({ ids, label, line, kind }: { ids: string[]; label: string; line: string; kind: "confirm" | "approve" }) {
  const ui = useUi();
  return <button type="button" className="b sm" disabled={ui.busy} onClick={() => (kind === "confirm" ? ui.confirmMat(ids, line) : ui.approveMat(ids, line))}>{label}</button>;
}

export function SupplierPaidButton({ ids, label, line }: { ids: string[]; label: string; line: string }) {
  const ui = useUi();
  return <button type="button" className="b pri" disabled={ui.busy} onClick={() => ui.paySupplier(ids, line)}>{label}</button>;
}

export function SnapReceiptButton() {
  const ui = useUi();
  return <button type="button" className="b sm" style={{ marginLeft: "auto" }} onClick={() => ui.pick(null)}>Snap a receipt</button>;
}

function PickSheet({ row, jobs, onClose, onPick, heading }: { row: MatSpec | null; jobs: PickJob[]; onClose: () => void; onPick: (j: PickJob) => void; heading?: { title: string; who: string } }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = jobs.filter((j) => !needle || `${j.address} ${j.customer ?? ""}`.toLowerCase().includes(needle)).slice(0, 40);
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="pickT">
        <h3 id="pickT">{heading ? heading.title : row ? "Which job is this for?" : "Snap a receipt for which job?"}</h3>
        <div className="who">{heading ? heading.who : row ? `${row.supplier} ${row.invoiceNo ?? ""} · ${row.amountLabel}${row.reference ? ` · supplier wrote “${row.reference}”` : ""}` : "Opens the job with Add cost ready for the photo."}</div>
        <div className="field"><input type="search" placeholder="Search address or customer" aria-label="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <div className="pick">
          {list.length ? list.map((j) => (
            <button key={j.workOrderId} type="button" onClick={() => onPick(j)}>{j.address}<small>{j.laneName}{j.customer ? ` · ${j.customer}` : ""} · {j.priceLabel}</small></button>
          )) : <div className="empty">No job matches.</div>}
        </div>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function DocSheet({ row, onClose }: { row: MatSpec; onClose: () => void }) {
  const [doc, setDoc] = useState<{ url: string | null; isImage: boolean } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    void materialDocAction({ kind: row.kind, id: row.id }).then((r) => { if (!live) return; if (r.ok) setDoc({ url: r.url, isImage: r.isImage }); else setErr(r.message); });
    return () => { live = false; };
  }, [row.kind, row.id]);
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Captured document" style={{ maxWidth: 500 }}>
        <h3>{row.supplier} {row.invoiceNo ?? ""}</h3>
        <div className="who">{row.invoiceDate ? `Dated ${row.invoiceDate}` : "Captured document"}</div>
        <div className="paper" data-testid="pm-doc">
          {err ? <p>{err}</p>
            : !doc ? <p>Opening the document…</p>
            : !doc.url ? <p>No document is attached to this row.</p>
            // A short-lived signed link to a private document: nothing for next/image to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            : doc.isImage ? <img src={doc.url} alt={`${row.supplier} document`} style={{ width: "100%", borderRadius: 8 }} />
            : <iframe src={doc.url} title={`${row.supplier} document`} style={{ width: "100%", height: 380, border: 0, borderRadius: 8, background: "#fff" }} />}
          {doc?.url ? <p><a href={doc.url} target="_blank" rel="noreferrer">Open the original in a new tab</a></p> : null}
        </div>
        <div className="read">
          <b>What was read from it</b>
          <span>Supplier: {row.supplier}</span>
          <span>Total: {row.amountLabel} including GST{row.unread ? " — not read, check the document" : ""}</span>
          <span>Reference: {row.reference ? `“${row.reference}”` : "none on the document"}</span>
          <span>Job: {row.jobAddress ?? "no job found"}</span>
        </div>
        <div className="docacts"><MatButtons row={row} inSheet /></div>
        <button type="button" className="cancel" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** A job cost on the panel (Step 8a): Approve, then ✓ Paid with Undo — the Materials block's own actions, by id. */
export function CostButtons({ id, status, label }: { id: string; status: string; label: string }) {
  const ui = useUi();
  if (status === "recorded") return <button type="button" className="b sm pri" disabled={ui.busy} onClick={() => ui.approveMat([id], `${label} approved.`)}>Approve</button>;
  if (status === "approved") return <button type="button" className="b sm pri" disabled={ui.busy} onClick={() => ui.paySupplier([id], `${label} marked paid.`)}>✓ Paid</button>;
  return null;
}

// ---- 8b: Green fast terms, and the expense queues -------------------------------------

/** Hold a Green painter's fast payment (back on default terms, never later) or release the hold. */
export function TermsButtons({ id, terms }: { id: string; terms: "default" | "green_fast" | "held" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => { const r = await fn(); if (!r.ok) setErr(r.message ?? "That didn't work."); else { setErr(""); router.refresh(); } });
  if (terms === "green_fast") return <>
    <button type="button" className="b" disabled={busy} onClick={() => {
      const reason = window.prompt("Why hold the fast payment? (the customer raised something…)");
      if (reason && reason.trim().length >= 3) run(() => holdFastTermsAction({ contractorInvoiceId: id, reason: reason.trim() }));
    }}>Hold fast payment</button>{err ? <span className="err"> {err}</span> : null}</>;
  if (terms === "held") return <><button type="button" className="b" disabled={busy} onClick={() => run(() => releaseFastTermsAction({ contractorInvoiceId: id }))}>Release</button>{err ? <span className="err"> {err}</span> : null}</>;
  return null;
}

/** One expense line's decision: a claim (Approve / Reject), an ask-first request (Approve up to a cap / Decline), or money owed back (Paid back). */
export function ExpenseButtons({ kind, id, estimateCents }: { kind: "claim" | "ask" | "payback"; id: string; estimateCents: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [capping, setCapping] = useState(false);
  const [cap, setCap] = useState(centsAsInput(estimateCents));
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => { const r = await fn(); setMsg(r.message ?? ""); if (r.ok) router.refresh(); });
  if (kind === "payback") return <><button type="button" className="b pri" disabled={busy} onClick={() => run(() => markReimbursedAction({ expenseId: id }))}>Paid back</button>{msg ? <span className="err"> {msg}</span> : null}</>;
  if (kind === "claim") return <>
    <button type="button" className="b pri" disabled={busy} onClick={() => run(() => decideExpenseAction({ expenseId: id, approve: true }))}>Approve</button>
    <button type="button" className="b" disabled={busy} onClick={() => run(() => decideExpenseAction({ expenseId: id, approve: false }))}>Reject</button>
    {msg ? <span className="err"> {msg}</span> : null}</>;
  const capCents = parseDollarsToCents(cap);
  return <>
    {capping ? <>
      <label className="cust-amt"><span className="mono">$</span><input inputMode="decimal" aria-label="Approve up to" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
      <button type="button" className="b pri" disabled={busy || !capCents} onClick={() => run(() => decidePreapprovalAction({ preapprovalId: id, approve: true, capCents: capCents ?? undefined }))}>Approve up to {capCents ? fmt2(capCents) : "…"}</button>
    </> : <button type="button" className="b pri" disabled={busy} onClick={() => setCapping(true)}>Approve…</button>}
    <button type="button" className="b" disabled={busy} onClick={() => run(() => decidePreapprovalAction({ preapprovalId: id, approve: false }))}>Decline</button>
    {msg ? <span className="err"> {msg}</span> : null}</>;
}

// ---- 8c: any document as a cost ------------------------------------------------------

const COST_CATEGORIES: { key: string; label: string }[] = [
  { key: "materials", label: "Materials" }, { key: "scaffold", label: "Scaffold" }, { key: "render", label: "Render" },
  { key: "carpentry", label: "Carpentry" }, { key: "rubbish", label: "Rubbish" }, { key: "equipment_hire", label: "Equipment" },
  { key: "permit", label: "Permit" }, { key: "traffic_mgmt", label: "Traffic" }, { key: "other", label: "Other" },
];

/**
 * "Record as a cost…" (8c): the old Payables confirm panel — the job, what kind
 * of cost, and the total and GST, typed when the reading failed. GST defaults to
 * the total's tenth (lib/invoicing/gst); the server re-checks both.
 */
function CostSheet({ row, jobs, onClose, onDone }: { row: MatSpec; jobs: PickJob[]; onClose: () => void; onDone: (r: { ok: boolean; message?: string }) => void }) {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [job, setJob] = useState<PickJob | null>(jobs.find((j) => j.workOrderId === row.workOrderId) ?? null);
  const [category, setCategory] = useState("other");
  const [total, setTotal] = useState(row.amountCents ? centsAsInput(row.amountCents) : "");
  const totalCents = parseDollarsToCents(total);
  const [gst, setGst] = useState(row.amountCents ? centsAsInput(gstFromIncCents(row.amountCents, 10)) : "");
  const gstCents = gst.trim() === "" ? 0 : parseDollarsToCents(gst);
  const [err, setErr] = useState("");
  const needle = q.trim().toLowerCase();
  const list = jobs.filter((j) => !needle || `${j.address} ${j.customer ?? ""}`.toLowerCase().includes(needle)).slice(0, 20);
  const ok = !!job && !!totalCents && gstCents !== null && gstCents < totalCents;
  const save = () => {
    if (!job || !totalCents || gstCents === null) return;
    void (async () => {
      const r = await confirmCostAction({ intakeId: row.id, woId: job.workOrderId, estimateId: job.estimateId, category, vendorName: row.supplier,
        totalIncCents: totalCents, gstCents, invoiceNo: row.invoiceNo ?? "", invoiceDate: row.invoiceDateIso ?? null });
      if (!r.ok) { setErr(r.message ?? "That didn't save."); return; }
      onDone({ ok: true, message: `${row.supplier} ${fmt2(totalCents)} recorded on ${job.address.split(",")[0]}.` });
    })();
  };
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="costT">
        <h3 id="costT">Record as a cost</h3>
        <div className="who">{row.supplier}{row.invoiceNo ? ` ${row.invoiceNo}` : ""}{row.unread ? " · the amount couldn't be read, type it from the document" : ""}</div>
        <div className="field"><label>What kind of cost?</label>
          <div className="chipset">{COST_CATEGORIES.map((c) => <button key={c.key} type="button" className={category === c.key ? "on" : undefined} aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>)}</div>
        </div>
        <div className="field"><label htmlFor="costJob">Job</label>
          {job ? <div className="adj"><p style={{ margin: 0 }}><b>{job.address}</b> <button type="button" className="b sm" onClick={() => setJob(null)}>Change</button></p></div>
            : <><input id="costJob" type="search" placeholder="Search address or customer" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="pick">{list.map((j) => <button key={j.workOrderId} type="button" onClick={() => setJob(j)}>{j.address}<small>{j.laneName}{j.customer ? ` · ${j.customer}` : ""} · {j.priceLabel}</small></button>)}</div></>}
        </div>
        <div className="two">
          <div className="field"><label htmlFor="costTotal">Total inc GST ($)</label><input id="costTotal" className="money" inputMode="decimal" value={total}
            onChange={(e) => { setTotal(e.target.value); const c = parseDollarsToCents(e.target.value); if (c) setGst(centsAsInput(gstFromIncCents(c, 10))); }} /></div>
          <div className="field"><label htmlFor="costGst">GST ($)</label><input id="costGst" className="money" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} /></div>
        </div>
        <div className="err">{err}</div>
        <button type="button" className="b pri wide" disabled={ui.busy || !ok} onClick={save}>{totalCents ? `Record ${fmt2(totalCents)}` : "Record"}</button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** 8c: a materials invoice with no job — Assign to a job (`material_cost_assign`). */
export function AssignButton({ row }: { row: { id: string; supplier: string; amountLabel: string; reference: string | null } }) {
  const ui = useUi();
  return <button type="button" className="b sm pri" disabled={ui.busy} onClick={() => ui.assign(row)}>Assign to a job</button>;
}
