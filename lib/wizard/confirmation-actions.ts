import type { ConfirmationKind } from "./confirmation";

/**
 * What a person does with a confirmation — C6 (plan §2.6).
 *
 * "The estimator's day is the queue, with three actions per card: fix the price,
 * ask a question, book a visit."
 *
 * The desk-check screen deliberately LINKS to the flows that already own each
 * of those — prices change in the builder, questions happen in the thread,
 * visits in the visit flow — because "a fourth place to change money would be a
 * fourth place for it to go wrong". That stays true. What was missing is the
 * RECORD: a price that is fixed, by whom, when, and against which promise.
 * Without it there is no way to ask how long a confirmation took, or whether it
 * needed a visit in the end — the four numbers §2.6 says tell us if any of this
 * is working.
 *
 * So these are the rules for that record. Pure: no database, no clock. The
 * route does the writing; this decides what is allowed and what it means.
 */

export const CONFIRMATION_ACTIONS = ["fix_price", "ask_question", "book_visit"] as const;
export type ConfirmationAction = (typeof CONFIRMATION_ACTIONS)[number];

export type ConfirmationStatus =
  | "requested" | "question_asked" | "fixed" | "visit_booked" | "declined";

/** What a request looks like to these rules. */
export type ConfirmationRow = {
  status: ConfirmationStatus;
  kind: ConfirmationKind;
  fixed_price_cents?: number | null;
};

export type ActionVerdict =
  | { ok: true; nextStatus: ConfirmationStatus }
  | { ok: false; reason: string };

/**
 * May this action be taken on this request?
 *
 * The terminal states are terminal. A price that has been fixed is a promise
 * the customer is holding us to — re-fixing it silently would change a number
 * they have already been sent, which is the one thing a "fixed price" must
 * never do. Changing it is a variation, and variations have their own path with
 * the customer's signature on the end of it.
 *
 * `question_asked` is NOT terminal: asking something is how a request gets
 * ready to be fixed, and the answer should let it carry on.
 */
export function canAct(row: ConfirmationRow, action: ConfirmationAction): ActionVerdict {
  if (row.status === "fixed") {
    return { ok: false, reason: "This price is already fixed. Changing it now is a variation, not a re-fix." };
  }
  if (row.status === "declined") {
    return { ok: false, reason: "This request was declined. Start a new one if the customer is back." };
  }
  if (row.status === "visit_booked" && action !== "fix_price") {
    return { ok: false, reason: "A visit is already booked — fix the price after it, or cancel the visit first." };
  }
  const nextStatus: ConfirmationStatus =
    action === "fix_price" ? "fixed"
    : action === "book_visit" ? "visit_booked"
    : "question_asked";
  return { ok: true, nextStatus };
}

/**
 * The price a fix records.
 *
 * "Accept or enter the number" (C6). Accepting means the engine's own central
 * estimate — the midpoint, never the top of the band (⚑8), because a customer
 * who is shown a range and then charged its ceiling has been quoted the range
 * dishonestly. An entered number is taken as given: an estimator who has looked
 * at the job knows something the engine does not, which is the entire reason a
 * person is in this loop.
 *
 * Refuses a number that is not money. A fixed price is the one figure in this
 * system nobody gets to correct afterwards.
 */
export function priceToFix(input: {
  enteredCents?: number | null;
  rangeLoCents: number;
  rangeHiCents: number;
}): { ok: true; cents: number; source: "entered" | "central" } | { ok: false; reason: string } {
  const entered = input.enteredCents;
  if (entered != null) {
    if (!Number.isFinite(entered) || !Number.isInteger(entered) || entered <= 0) {
      return { ok: false, reason: "A fixed price has to be a whole number of cents, above zero." };
    }
    return { ok: true, cents: entered, source: "entered" };
  }
  const central = Math.round((input.rangeLoCents + input.rangeHiCents) / 2);
  if (!Number.isFinite(central) || central <= 0) {
    return { ok: false, reason: "There is no priced range to accept — open it in the builder first." };
  }
  return { ok: true, cents: central, source: "central" };
}

/**
 * Is this request overdue against what we promised?
 *
 * The hand-off screen tells the customer a turnaround; the queue is measured
 * against the same setting, or we promise one thing and chase another. Business
 * hours, not wall-clock: a request that arrives on Friday evening is not late
 * on Saturday morning, and treating it as late trains people to ignore the card.
 */
export function isOverdue(input: {
  requestedAt: string | Date;
  now: Date;
  turnaroundHours: number;
}): boolean {
  const from = input.requestedAt instanceof Date ? input.requestedAt : new Date(input.requestedAt);
  if (!Number.isFinite(from.getTime())) return false;
  let remaining = input.turnaroundHours;
  const cur = new Date(from.getTime());
  while (remaining > 0) {
    cur.setHours(cur.getHours() + 1);
    if (cur > input.now) return false;
    const day = cur.getDay();
    const hour = cur.getHours();
    // Mon–Fri, 8am–5pm. The wizard's own "Mon–Fri" promise (8 Sep).
    if (day >= 1 && day <= 5 && hour >= 8 && hour < 17) remaining -= 1;
  }
  return true;
}
