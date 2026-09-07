/**
 * The guard chain (session 3.1, rebuilt for CRM v2 P5 — deep dive §4.3).
 *
 * Between a customer being enrolled in a campaign and a message actually going
 * out, the world moves. They accept a quote. They say no to texts. They ring
 * up. Someone in the office takes the conversation over. They open the
 * estimate, so the "haven't you opened it?" text is no longer wanted.
 *
 * Every one of those is a reason NOT to send, and every one is checked here —
 * once, in one function, at SEND time rather than at enrolment time. The sweep
 * asks the first half (`judge`) before it queues anything, so the approval
 * queue never fills with messages that were already pointless; the sender asks
 * the whole chain (`guardSend`) again in the second before it sends.
 *
 * Pure. No clients, no clock of its own, no I/O — so every refusal is a test.
 */

export type CampaignClass = "marketing" | "followup";

export const CAMPAIGN_CLASSES: Array<{ key: CampaignClass; label: string; help: string }> = [
  { key: "followup", label: "Quote follow-up",
    help: "Service messages about a quote they asked for. Short, allowed to people who haven't accepted, stops the moment they answer, not counted against the monthly marketing cap. Skips anyone delayed, lost or do-not-contact." },
  { key: "marketing", label: "Marketing",
    help: "Offers and news. One marketing message per customer per month (C10), weekdays 9–6 (C11), never to a declined channel or a quiet customer." },
];

/** What a step can ask before it goes. Judged against the ANCHOR — the event
 *  or enrolment the sequence hangs off — not against all of history. */
export type StepCondition = "none" | "unopened" | "opened_silent" | "not_replied" | "not_accepted";
export const STEP_CONDITIONS: Array<{ key: StepCondition; label: string; help: string }> = [
  { key: "none", label: "Always", help: "Send it when it's due." },
  { key: "unopened", label: "Only if they haven't opened the estimate", help: "Skipped the moment an open is recorded." },
  { key: "opened_silent", label: "Only if they opened it and went quiet", help: "They looked; nobody has heard from them since." },
  { key: "not_replied", label: "Only if they haven't replied", help: "Any message or call from them cancels it." },
  { key: "not_accepted", label: "Only if they haven't accepted", help: "An acceptance cancels it." },
];

export type ExitRule = "replied" | "called" | "accepted" | "declined" | "do_not_contact" | "staff_took_over";
export const EXIT_RULES: Array<{ key: ExitRule; label: string; help: string; always?: CampaignClass[] }> = [
  { key: "replied", label: "They reply on any channel", help: "An email, a text or a chat from them ends the sequence.", always: ["followup"] },
  { key: "called", label: "They ring us", help: "A logged call from them, or a callback request." },
  { key: "accepted", label: "They accept a quote", help: "The sequence has done its job.", always: ["followup", "marketing"] },
  { key: "declined", label: "They decline a quote", help: "Nothing more to chase.", always: ["followup"] },
  { key: "do_not_contact", label: "Marked do-not-contact", help: "Always on — listed so nobody wonders.", always: ["followup", "marketing"] },
  { key: "staff_took_over", label: "Someone here logs a call, email or text", help: "A person has the conversation now; the machine steps back." },
];

export type SendPolicy = {
  /** No more than this many marketing messages to one customer in the window. */
  maxPerCustomer: number;
  frequencyWindowDays: number;
  /** Local hours, inclusive start, exclusive end. Outside this, hold. */
  quietHoursStart: number;
  quietHoursEnd: number;
  /** 0 = Sunday. Days marketing may go out at all. */
  permittedDays: number[];
  /** OFF by default. P5: a per-campaign switch, wired in by the caller. When
   *  false, a message needs a human's approval no matter how clean it is. */
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
  /** When the enrolment was made. */
  enrolledAt: string;
  /** The event (or enrolment) the waits and the conditions count from. */
  anchorAt: string;
  step: number;
  condition: StepCondition;
};

export type CampaignRules = {
  class: CampaignClass;
  exitRules: ExitRule[];
  /** Audience campaigns re-ask the list at send time; event campaigns have no list to re-ask. */
  entry: "audience" | "event";
};

/** The customer as they are NOW — read off the facts row and the account. */
export type CustomerState = {
  /** Their answer for THIS channel (accounts.permit_email / permit_sms). */
  permit: "allowed" | "declined" | "unknown";
  /** The older single flag, still honoured (a spam complaint sets it). */
  unsubscribed: boolean;
  /** Hard bounce or repeated failure: stop writing to a dead address. */
  undeliverable: boolean;
  /** An address or a mobile for this channel exists at all. */
  reachable: boolean;
  relationshipState: string;
  /** Delayed, and the date has not passed. */
  stateHolding: boolean;
  /** Still matches the audience, re-evaluated NOW (audience campaigns). */
  stillInAudience: boolean;
  /** A job on — stage job_on. */
  hasOpenWork: boolean;
  lastAcceptedAt: string | null;
  lastDeclinedAt: string | null;
  lastOpenedAt: string | null;
  lastInboundAt: string | null;
  lastInboundCallAt: string | null;
  lastStaffContactAt: string | null;
  snoozedUntil: string | null;
  /** When we last sent this customer any MARKETING message. */
  lastMarketingAt: string | null;
};

export type MessageState = {
  templateApproved: boolean;
  humanApproved: boolean;
  /** This send key has already been used — the idempotency stop. */
  alreadySent: boolean;
};

export type GuardVerdict =
  | { send: true }
  | {
      send: false;
      reason: string;
      /** Try again later (quiet hours, frequency, snooze, waiting for a person). */
      hold: boolean;
      /** The enrolment is over — nothing further in this sequence goes. */
      exit?: boolean;
      /** This step only is not wanted; the sequence continues. */
      skip?: boolean;
    };

const stop = (reason: string, extra: { hold?: boolean; exit?: boolean; skip?: boolean } = {}): GuardVerdict =>
  ({ send: false, reason, hold: extra.hold ?? false, ...(extra.exit ? { exit: true } : {}), ...(extra.skip ? { skip: true } : {}) });

const after = (at: string | null, since: string): boolean => at != null && at > since;
const hoursBetween = (from: string | null, now: Date): number | null =>
  from == null ? null : (now.getTime() - new Date(from).getTime()) / 3_600_000;

/** The exits that are on whatever the campaign says. */
export function effectiveExits(rules: CampaignRules): Set<ExitRule> {
  const on = new Set<ExitRule>(rules.exitRules);
  for (const e of EXIT_RULES) if (e.always?.includes(rules.class)) on.add(e.key);
  return on;
}

/**
 * The first half: is this message still WANTED? Consent, the customer's state,
 * the exit rules, the audience, the step's condition. Nothing about timing or
 * approval — the sweep runs this before it queues, so a customer who replied
 * last night is finished this morning instead of sitting in the queue.
 */
export function judge(candidate: SendCandidate, customer: CustomerState, rules: CampaignRules): GuardVerdict {
  const channel = candidate.channel === "sms" ? "texts" : "emails";

  // 1 · consent. Nothing overrides it, and it is never a "hold".
  if (customer.permit === "declined") return stop(`They said no to ${channel}.`, { exit: true });
  if (rules.class === "marketing" && customer.unsubscribed) return stop("They unsubscribed.", { exit: true });

  // 2 · the customer's state. Do-not-contact and archived silence everything.
  //     A follow-up has nothing to say to someone delayed or lost; marketing
  //     waits out a delay and may still speak to someone marked lost.
  if (customer.relationshipState === "do_not_contact") return stop("Marked do not contact.", { exit: true });
  if (customer.relationshipState === "archived") return stop("Archived.", { exit: true });
  if (rules.class === "followup" && customer.relationshipState === "lost") return stop("Marked lost.", { exit: true });
  if (rules.class === "followup" && customer.relationshipState === "delayed") return stop("Delayed — the office said not yet.", { exit: true });
  if (customer.stateHolding) return stop("Delayed until their date.", { hold: true });

  // 3 · deliverability, and a channel they can be reached on at all.
  if (customer.undeliverable && candidate.channel === "email") return stop("Their address has been bouncing.", { exit: true });
  if (!customer.reachable) return stop(candidate.channel === "sms" ? "No mobile number on file." : "No email address on file.", { skip: true });

  // 4 · the exit rules, all measured from the anchor.
  const exits = effectiveExits(rules);
  if (exits.has("accepted") && after(customer.lastAcceptedAt, candidate.anchorAt)) return stop("They accepted a quote.", { exit: true });
  if (exits.has("declined") && after(customer.lastDeclinedAt, candidate.anchorAt)) return stop("They declined the quote.", { exit: true });
  if (exits.has("replied") && after(customer.lastInboundAt, candidate.anchorAt)) return stop("They replied.", { exit: true });
  if (exits.has("called") && after(customer.lastInboundCallAt, candidate.anchorAt)) return stop("They rang us.", { exit: true });
  if (exits.has("staff_took_over") && after(customer.lastStaffContactAt, candidate.anchorAt)) return stop("Someone here has taken it over.", { exit: true });

  // 5 · marketing never runs alongside a job, or after an acceptance since enrolment.
  if (rules.class === "marketing" && customer.hasOpenWork) return stop("They have work on with us.", { exit: true });
  if (rules.class === "marketing" && after(customer.lastAcceptedAt, candidate.enrolledAt)) return stop("They accepted a quote after this was queued.", { exit: true });

  // 6 · still the right person for this list. A list is a live question.
  if (rules.entry === "audience" && !customer.stillInAudience) return stop("They no longer match the list.", { exit: true });

  // 7 · the step's own condition.
  switch (candidate.condition) {
    case "unopened":
      if (after(customer.lastOpenedAt, candidate.anchorAt)) return stop("They opened it — this step isn't needed.", { skip: true });
      break;
    case "opened_silent":
      if (!after(customer.lastOpenedAt, candidate.anchorAt)) return stop("They haven't opened it — this step is for people who have.", { skip: true });
      if (after(customer.lastInboundAt, candidate.anchorAt)) return stop("They've been in touch since.", { skip: true });
      break;
    case "not_replied":
      if (after(customer.lastInboundAt, candidate.anchorAt)) return stop("They've replied — this step isn't needed.", { skip: true });
      break;
    case "not_accepted":
      if (after(customer.lastAcceptedAt, candidate.anchorAt)) return stop("They accepted — this step isn't needed.", { skip: true });
      break;
  }

  return { send: true };
}

/**
 * The whole chain: `judge`, then everything about WHEN and WHO SAID SO.
 *
 * Order matters for the REASON, not the outcome: a customer who both declined
 * texts and accepted should read as "said no", because that is the one with
 * legal weight.
 */
export function guardSend(
  candidate: SendCandidate,
  customer: CustomerState,
  message: MessageState,
  rules: CampaignRules,
  policy: SendPolicy,
  now: Date,
  localHour: number = now.getHours(),
  localDay: number = now.getDay(),
): GuardVerdict {
  // Idempotency first among the mechanical checks: the same send key twice is
  // the sweep having run twice, and that is never something to retry.
  if (message.alreadySent) return stop("Already sent — this is a repeat run.");

  const wanted = judge(candidate, customer, rules);
  if (!wanted.send) return wanted;

  // Staff judgement outranks the machine.
  if (customer.snoozedUntil && new Date(customer.snoozedUntil) > now) return stop("Someone snoozed them.", { hold: true });

  // Frequency — marketing only. A follow-up about their own quote is not a
  // marketing touch, and must not be blocked by last month's newsletter.
  if (rules.class === "marketing") {
    const since = hoursBetween(customer.lastMarketingAt, now);
    if (since != null && since < policy.frequencyWindowDays * 24) {
      const days = Math.ceil(policy.frequencyWindowDays - since / 24);
      return stop(`Messaged them ${Math.floor(since / 24)} days ago — ${days} to go.`, { hold: true });
    }
  }

  // When. Quiet hours and permitted days, then the approval that must exist
  // before anything at all leaves.
  if (!policy.permittedDays.includes(localDay)) return stop("Not a sending day.", { hold: true });
  if (localHour < policy.quietHoursStart || localHour >= policy.quietHoursEnd) return stop("Outside sending hours.", { hold: true });
  if (!message.templateApproved) return stop("Nobody has read the template yet.", { hold: true });
  if (!policy.autoSend && !message.humanApproved) return stop("Waiting for approval.", { hold: true });

  return { send: true };
}

/** Everything that would go out, and everything that would not — the panel the
 *  office reads before turning anything on. */
export function dryRun(
  candidates: Array<{ candidate: SendCandidate; customer: CustomerState; message: MessageState }>,
  rules: CampaignRules,
  policy: SendPolicy,
  now: Date,
  localHour?: number,
  localDay?: number,
): { going: SendCandidate[]; held: Array<{ candidate: SendCandidate; reason: string }>; stopped: Array<{ candidate: SendCandidate; reason: string }> } {
  const going: SendCandidate[] = [];
  const held: Array<{ candidate: SendCandidate; reason: string }> = [];
  const stopped: Array<{ candidate: SendCandidate; reason: string }> = [];
  for (const row of candidates) {
    const v = guardSend(row.candidate, row.customer, row.message, rules, policy, now, localHour, localDay);
    if (v.send) going.push(row.candidate);
    else if (v.hold) held.push({ candidate: row.candidate, reason: v.reason });
    else stopped.push({ candidate: row.candidate, reason: v.reason });
  }
  return { going, held, stopped };
}

/**
 * The send key: one per customer, campaign, anchor and step, forever.
 *
 * Deliberately carries no timestamp. A key with a date in it is a key that
 * lets the same message go twice tomorrow. The anchor is what lets the same
 * customer go through a follow-up again on a NEW quote a year later.
 */
export function sendKey(campaignKey: string, accountId: string, step: number, anchorKey = ""): string {
  return `${campaignKey}:${accountId}${anchorKey ? `:${anchorKey}` : ""}:step${step}`.toLowerCase();
}
