/**
 * Call backs (brief Step 3; rulings C1–C11). Pure: the words, the states and
 * the one rule the evaluator (Step 5) will read — whether a call back is
 * SCORED against the painter. Shared by server and client code.
 */

export const CALLBACK_SOURCES = ["qc_fail", "walkthrough_fail", "customer_call", "scheduler"] as const;
export type CallbackSource = (typeof CALLBACK_SOURCES)[number];

export const CALLBACK_REASONS = ["workmanship", "not_workmanship"] as const;
export type CallbackReason = (typeof CALLBACK_REASONS)[number];

export const CALLBACK_STATUSES = ["open", "booked", "fixed", "done", "void"] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export const SOURCE_LABEL: Record<CallbackSource, string> = {
  qc_fail: "Quality check failed",
  walkthrough_fail: "Flagged at the walk-through",
  customer_call: "Customer called back",
  scheduler: "Booked in the scheduler",
};

export const REASON_LABEL: Record<CallbackReason, string> = {
  workmanship: "Workmanship",
  not_workmanship: "Not workmanship",
};

export const STATUS_LABEL: Record<CallbackStatus, string> = {
  open: "Open — no visit booked",
  booked: "Return visit booked",
  fixed: "Marked fixed — waiting for the office to confirm",
  done: "Closed",
  void: "Voided",
};

/** The states that count as "a call back is open" (the Flow column, the hold, the cards). */
export const OPEN_STATUSES: readonly CallbackStatus[] = ["open", "booked", "fixed"];
export const isOpenStatus = (s: CallbackStatus): boolean => OPEN_STATUSES.includes(s);

export type Callback = {
  id: string;
  workOrderId: string;
  painterId: string;
  fixedByPainterId: string | null;
  source: CallbackSource;
  reason: CallbackReason;
  reportedOn: string;
  description: string;
  status: CallbackStatus;
  appointmentId: string | null;
  qaCheckId: string | null;
  fixedAt: string | null;
  fixedNote: string;
  closedAt: string | null;
  closedNote: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
  /** The booked return visit, when one exists. */
  visit: { start: string; end: string; contractorId: string } | null;
};

/** Days between two calendar dates (YYYY-MM-DD), b − a. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number); const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Brief §4.3: a call back is SCORED when its reason is workmanship AND it was
 * reported before sign-off, or on or before sign-off day + windowDays (C6, 7).
 * `signedOn` is the sign-off's Melbourne calendar day; a job never signed off
 * (a call back from a failed check or a flag) scores on reason alone. A voided
 * call back never scores.
 */
export function callbackScored(cb: Pick<Callback, "reason" | "reportedOn" | "status">, signedOn: string | null, windowDays = 7): boolean {
  if (cb.status === "void" || cb.reason !== "workmanship") return false;
  if (!signedOn) return true;
  return dayDiff(signedOn, cb.reportedOn) <= windowDays;
}

export const dmy = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** One line for a job card or a painter's phone. */
export function callbackLine(cb: Callback): string {
  const visit = cb.visit ? `Return visit ${dmy(cb.visit.start)}${cb.visit.end !== cb.visit.start ? ` – ${dmy(cb.visit.end)}` : ""}` : "No return visit booked yet";
  return `${SOURCE_LABEL[cb.source]} · reported ${dmy(cb.reportedOn)} · ${visit}`;
}
