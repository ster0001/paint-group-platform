import { addBusinessHours } from "@/lib/time/businessHours";
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
 * against the same setting, or we promise one thing and chase another.
 *
 * Business hours via `addBusinessHours` — the one implementation, which is
 * Melbourne-aware through `melbourneParts`. The first version of this walked
 * hours with `getHours()` and `getDay()`, i.e. the RUNTIME's local time. Its
 * tests passed because vitest runs under TZ=Australia/Melbourne; on a UTC
 * server it would have called Friday-evening requests overdue on Saturday and
 * missed real ones by ten or eleven hours depending on daylight saving. That is
 * the trap CLAUDE.md's Dates section names, written again by hand next to a
 * helper that already solved it.
 */
export function isOverdue(input: {
  requestedAt: string | Date;
  now: Date;
  turnaroundHours: number;
}): boolean {
  const from = input.requestedAt instanceof Date ? input.requestedAt : new Date(input.requestedAt);
  if (!Number.isFinite(from.getTime())) return false;
  return addBusinessHours(from, input.turnaroundHours) <= input.now;
}

/**
 * The turnaround we promise, from Settings.
 *
 * `hours` is what the queue's overdue card counts in business hours; `words`
 * is what the customer is told on the hand-off screen. One row, because a
 * promise and the thing that chases it must not be two different numbers.
 */
export type TurnaroundSetting = { hours: number; words: string };

export const DEFAULT_TURNAROUND_SETTING: TurnaroundSetting = {
  hours: 8,
  words: "usually by the next working day",
};

export function turnaroundFromSettings(value: unknown): TurnaroundSetting {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hours = typeof v.hours === "number" && Number.isFinite(v.hours) && v.hours > 0
    ? Math.min(v.hours, 24 * 30) : DEFAULT_TURNAROUND_SETTING.hours;
  const words = typeof v.words === "string" && v.words.trim()
    ? v.words.trim().slice(0, 120) : DEFAULT_TURNAROUND_SETTING.words;
  return { hours, words };
}

/**
 * What the CUSTOMER is told their request is doing.
 *
 * Derived from the row, never stored — the status is the truth and a second
 * copy of it in words would drift. `null` means there is no request, which is
 * its own honest answer: the sent screen still says what happens next.
 */
export function customerStatusLine(input: {
  status: ConfirmationStatus | null;
  kind: ConfirmationKind | null;
  fixedPriceCents?: number | null;
  coordinator: string;
  turnaroundWords: string;
}): { headline: string; detail: string } | null {
  const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;
  switch (input.status) {
    case null:
      return null;
    case "requested":
      return input.kind === "visit"
        ? { headline: "A visit is being arranged", detail: `${input.coordinator} will call to agree a time.` }
        : { headline: "With your estimator now", detail: `${input.coordinator} is checking it — ${input.turnaroundWords}.` };
    case "question_asked":
      return { headline: `${input.coordinator} has asked you something`, detail: "One answer and it carries on — check your messages." };
    case "fixed":
      return input.fixedPriceCents
        ? { headline: `Your price is fixed — ${money(input.fixedPriceCents)}`, detail: "Inc. GST, held for 60 days. Nothing changes without your say-so." }
        : { headline: "Your price is fixed", detail: "Inc. GST, held for 60 days." };
    case "visit_booked":
      return { headline: "Your visit is booked", detail: `${input.coordinator} arrives with your answers already on the tablet.` };
    case "declined":
      return { headline: "We couldn't price this one", detail: `${input.coordinator} will be in touch to explain.` };
  }
}
