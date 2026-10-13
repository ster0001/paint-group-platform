import { expenseTotals, type ExpenseItem, type ExpenseQueues } from "@/lib/invoicing/expenses";
import { ExpenseButtons, OpenJobLink } from "./ActionsClient";
import { money, plural } from "./labels";

/**
 * Expenses on the Contractors tab (Payments merge 8b), moved from the old
 * Payables tab: claims to decide, ask-first requests over the threshold, and
 * what an employee paid from their own pocket. Totals: lib/invoicing/expenses.ts.
 */
function Line({ x, kind }: { x: ExpenseItem; kind: "claim" | "ask" | "payback" }) {
  return (
    <div className="prow" data-expense={x.id}>
      <div className="p1"><b>{x.who}</b><small>{kind === "ask" ? x.description : x.note}{x.overThreshold ? " · over the threshold, not asked first" : ""}</small></div>
      <div className="p2">{x.estimateId ? <OpenJobLink className="jl" estimateId={x.estimateId}>{x.ref}</OpenJobLink> : x.ref}</div>
      <div className="p3"><span className={`owe ${kind === "payback" ? "need" : "sent"}`}>{money(x.amountCents)}</span><small>{kind === "ask" ? "their estimate" : kind === "payback" ? "owed back" : "claimed"}</small></div>
      <div className="p4">
        <ExpenseButtons kind={kind} id={x.id} estimateCents={x.amountCents} />
        {x.receiptUrl ? <a className="b" href={x.receiptUrl} target="_blank" rel="noreferrer">Receipt</a> : null}
      </div>
    </div>
  );
}

function Sec({ title, note, items, kind, cents, testid }: { title: string; note: string; items: ExpenseItem[]; kind: "claim" | "ask" | "payback"; cents: number; testid: string }) {
  if (!items.length) return null;
  return (
    <section className="sec" data-testid={testid}>
      <div className="sec-h"><h2>{title}</h2><span className="tot"><small>{plural(items.length, kind === "ask" ? "request" : "claim")}</small>{money(cents)}</span></div>
      <p className="sec-note">{note}</p>
      {items.map((x) => <Line key={x.id} x={x} kind={kind} />)}
    </section>
  );
}

export function ExpensesView({ q }: { q: ExpenseQueues }) {
  const t = expenseTotals(q);
  return (
    <div id="expenses" data-testid="pm-expenses">
      <Sec testid="expense-claims" title="Expense claims to decide" kind="claim" items={q.claims} cents={t.claimsCents}
        note="Approved claims ride the contractor's next invoice as a reimbursement line. Rejecting tells them why in their app." />
      <Sec testid="preapprovals" title="Ask first: over-threshold purchases" kind="ask" items={q.asks} cents={t.asksCents}
        note="Approve up to a cap, or decline. The contractor sees the answer straight away." />
      <Sec testid="reimbursements" title="Owed back to employees" kind="payback" items={q.paybacks} cents={t.owedBackCents}
        note="Approved claims an employed painter paid from their own pocket. Pay them through payroll or a transfer, then press Paid back." />
    </div>
  );
}
