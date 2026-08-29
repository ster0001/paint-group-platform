/**
 * The guard chain (session 3.1).
 *
 * Between a customer being enrolled in a campaign and a message actually going
 * out, the world moves. They accept a quote. They unsubscribe. They ring up and
 * book. They get three emails in a week because two campaigns matched.
 *
 * Every one of those is a reason NOT to send, and every one is checked here —
 * once, in one function, at SEND time rather than at enrolment time. The
 * brief's acceptance gate is precisely this: "a customer who accepts between
 * enrolment and send receives nothing."
 *
 * Pure. No clients, no clock of its own, no I/O — so every refusal is a test.
 */

export type SendPolicy = {
  /** No more than this many marketing messages to one customer in the window. */
  maxPerCustomer: number;
  frequencyWindowDays: number;
  /** Local hours, inclusive start, exclusive end. Outside this, hold. */
  quietHoursStart: number;
  quietHoursEnd: number;
  /** 0 = Sunday. Days marketing may go out at all. */
  permittedDays: number[];
  /** OFF by default and shipped OFF (brief §1). When false, a message needs a
   *  human's approval no matter how clean it is. */
  autoSend: boolean;
};

/**
 * Ruled by Tom, 29 Aug 2026:
 *   C10 — one marketing message per customer per MONTH. A repaint cycle is
 *         measured in years, so monthly is already frequent relative to how
 *         often someone needs a painter.
 *   C11 — weekdays, 9am to 6pm. An email landing at 9pm reads as automated,
 *         which undoes the personal tone the whole studio is built for.
 */
export const DEFAULT_POLICY: SendPolicy = {
  maxPerCustomer: 1,
  frequencyWindowDays: 30,
  quietHoursStart: 9,
  quietHoursEnd: 18,
  permittedDays: [1, 2, 3, 4, 5],
  autoSend: false,
};

export type SendCandidate = {
  sendKey: string;
  accountId: string;
  campaignKey: string;
  channel: "email" | "sms";
  /** Snapshot of the state at enrolment, for the "what changed" comparison. */
  enrolledAt: string;
};

export type CustomerState = {
  unsubscribed: boolean;
  /** Still matches the segment the campaign targets, re-evaluated NOW. */
  stillInSegment: boolean;
  /** Accepted a quote, or has a job on. The single most important refusal. */
  hasOpenWork: boolean;
  acceptedSince: string | null;
  snoozedUntil: string | null;
  /** When we last sent this customer any marketing message. */
  lastMarketingAt: string | null;
  /** Hard bounce or repeated failure: stop writing to a dead address. */
  undeliverable: boolean;
};

export type MessageState = {
  templateApproved: boolean;
  humanApproved: boolean;
  /** This send key has already been used — the idempotency stop. */
  alreadySent: boolean;
};

export type GuardVerdict =
  | { send: true }
  | { send: false; reason: string; hold: boolean };

/** `hold` = try again later (quiet hours, frequency). Otherwise the message is
 *  cancelled outright and the enrolment ends. */
function stop(reason: string, hold = false): GuardVerdict {
  return { send: false, reason, hold };
}

const hoursBetween = (from: string | null, now: Date): number | null =>
  from == null ? null : (now.getTime() - new Date(from).getTime()) / 3_600_000;

/**
 * The eight checks, in the order that makes the refusal most useful.
 *
 * Order matters for the REASON, not the outcome: a customer who both
 * unsubscribed and accepted should read as "unsubscribed", because that is the
 * one with legal weight.
 */
export function guardSend(
  candidate: SendCandidate,
  customer: CustomerState,
  message: MessageState,
  policy: SendPolicy,
  now: Date,
  localHour: number = now.getHours(),
  localDay: number = now.getDay(),
): GuardVerdict {
  // 1 · consent. Nothing overrides it, and it is never a "hold" — an
  //     unsubscribed customer is not a scheduling problem.
  if (customer.unsubscribed) return stop("They unsubscribed.");

  // 2 · deliverability. Writing to a dead address hurts every other email.
  if (customer.undeliverable) return stop("Their address has been bouncing.");

  // 3 · idempotency. The same send key twice is the sweep having run twice.
  if (message.alreadySent) return stop("Already sent — this is a repeat run.");

  // 4 · the one the brief names: they accepted between enrolment and send.
  if (customer.hasOpenWork) return stop("They have work on with us.");
  if (customer.acceptedSince && customer.acceptedSince > candidate.enrolledAt) {
    return stop("They accepted a quote after this was queued.");
  }

  // 5 · still the right person for this list. A segment is a live question, so
  //     it is asked again here — the list they were on is not the list they are
  //     on now.
  if (!customer.stillInSegment) return stop("They no longer match the list.");

  // 6 · staff judgement outranks the machine.
  if (customer.snoozedUntil && new Date(customer.snoozedUntil) > now) {
    return stop("Someone snoozed them.", true);
  }

  // 7 · frequency. A hold, not a cancel: they will be due later.
  const since = hoursBetween(customer.lastMarketingAt, now);
  if (since != null && since < policy.frequencyWindowDays * 24) {
    const days = Math.ceil(policy.frequencyWindowDays - since / 24);
    return stop(`Messaged them ${Math.floor(since / 24)} days ago — ${days} to go.`, true);
  }

  // 8 · when. Quiet hours and permitted days, then the approval that must
  //     exist before anything at all leaves.
  if (!policy.permittedDays.includes(localDay)) return stop("Not a sending day.", true);
  if (localHour < policy.quietHoursStart || localHour >= policy.quietHoursEnd) {
    return stop("Outside sending hours.", true);
  }
  if (!message.templateApproved) return stop("Nobody has read the template yet.", true);
  if (!policy.autoSend && !message.humanApproved) return stop("Waiting for approval.", true);

  return { send: true };
}

/** Everything that would go out, and everything that would not — the panel the
 *  office reads before turning anything on. */
export function dryRun(
  candidates: Array<{ candidate: SendCandidate; customer: CustomerState; message: MessageState }>,
  policy: SendPolicy,
  now: Date,
  localHour?: number,
  localDay?: number,
): { going: SendCandidate[]; held: Array<{ candidate: SendCandidate; reason: string }>; stopped: Array<{ candidate: SendCandidate; reason: string }> } {
  const going: SendCandidate[] = [];
  const held: Array<{ candidate: SendCandidate; reason: string }> = [];
  const stopped: Array<{ candidate: SendCandidate; reason: string }> = [];

  for (const row of candidates) {
    const v = guardSend(row.candidate, row.customer, row.message, policy, now, localHour, localDay);
    if (v.send) going.push(row.candidate);
    else if (v.hold) held.push({ candidate: row.candidate, reason: v.reason });
    else stopped.push({ candidate: row.candidate, reason: v.reason });
  }
  return { going, held, stopped };
}

/**
 * The send key: one per customer, campaign and step, forever.
 *
 * Deliberately carries no timestamp. A key with a date in it is a key that
 * lets the same message go twice tomorrow, which is exactly the duplicate the
 * idempotency gate exists to stop.
 */
export function sendKey(campaignKey: string, accountId: string, step: number): string {
  return `${campaignKey}:${accountId}:step${step}`.toLowerCase();
}
