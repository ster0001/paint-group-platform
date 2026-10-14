/**
 * The expense queues on the Contractors tab (Payments merge 8b), moved from the
 * old Payables tab: expense claims to decide, ask-first requests over the
 * threshold, and approved claims an employee paid from their own pocket.
 * Pure: the totals the ledger card and the section heads show.
 */

export type ExpenseItem = {
  id: string;
  /** Contractor company, or the employee's name for money owed back. */
  who: string;
  /** "materials · J-0123 · 12 Kite St" — what and where. */
  ref: string;
  estimateId: string | null;
  amountCents: number;
  note: string | null;
  /** A claim over the ask-first threshold with no approval behind it. */
  overThreshold: boolean;
  /** A short-lived signed link to the receipt, for claims. */
  receiptUrl: string | null;
  /** Ask-first: what they want to buy. */
  description: string | null;
};

export type ExpenseQueues = {
  claims: ExpenseItem[];
  asks: ExpenseItem[];
  paybacks: ExpenseItem[];
};

export type ExpenseTotals = {
  /** Claims + ask-first requests: decisions waiting on the office. */
  toDecideCount: number;
  claimsCents: number;
  asksCents: number;
  owedBackCents: number;
  owedBackCount: number;
};

const sum = (xs: readonly ExpenseItem[]) => xs.reduce((s, x) => s + x.amountCents, 0);

export function expenseTotals(q: ExpenseQueues): ExpenseTotals {
  return {
    toDecideCount: q.claims.length + q.asks.length,
    claimsCents: sum(q.claims), asksCents: sum(q.asks),
    owedBackCents: sum(q.paybacks), owedBackCount: q.paybacks.length,
  };
}
