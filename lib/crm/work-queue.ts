import type { SupabaseClient } from "@supabase/supabase-js";
import { needsSignoff, standardsCardDueAt, type StandardsRules, type StandardsStatus } from "@/lib/standards/acks";
import { loadStandardsRules, loadStandardsStatuses } from "@/lib/standards/status";
import { inSlices as sliceRead } from "@/lib/supabase/inSlices";
import { isQuiet } from "./states";
import { loadCrmThresholds, type CrmThresholds } from "./thresholds";
import { invoiceIsOverdue, invoiceBalanceCents, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import { OPEN_STATUSES } from "@/lib/invoicing/stateMachine";
import { bucketPill, journeyLine, journeyWho, pageLabel, type WizardBucket } from "@/lib/wizard/journey";
import {
  DEFAULT_POLICY, policyFromSettings, remoteConfirmVerdict, settingValue,
  type WizardPolicySettings,
} from "@/lib/wizard/policy";
import { sortQueue } from "@/lib/wizard/confirmation";
import { DEFAULT_TURNAROUND_SETTING, isOverdue, turnaroundFromSettings, type TurnaroundSetting } from "@/lib/wizard/confirmation-actions";
import { addBusinessHours, melbourneInstant, melbourneParts, nextBusinessMorning } from "@/lib/time/businessHours";
import { nextYearHolidaysMissing } from "@/lib/time/workingDays";
import { mergeBookingRules } from "@/lib/visits/schedule";
import { customerCheckins, dayLabel, jobDays } from "@/lib/workorder/jobRhythm";
import { melbourneDayStartUtc } from "@/lib/workorder/console";
import { openHolds } from "@/lib/scheduling/holds";

/**
 * The work queue (shell brief §3) — the one answer to "what needs a human?".
 *
 * Derived, never stored. A work item is a fact about the world, computed:
 * Sarah's question is outstanding because no reply has been sent, not because
 * a task row exists. Reply to her and the item disappears — nothing to tick.
 * There is no work_items table, and a PR that adds one fails review.
 *
 * The durable rule this file enforces for every module, including ones not
 * designed yet: a module that needs to tell a person something emits a work
 * item here — one source function plus a registry entry. It does not build
 * its own list, badge, inbox or queue. Two implementations of "what needs
 * attention" is a single-source violation.
 *
 * Today, the tab badge and every filter chip all call `buildWorkQueue`. The
 * chips are filters over the same computed list, never separate queries.
 */

// ---- item shape (brief §3.2) ----------------------------------------------

export const WORK_ITEM_KINDS = [
  "message_unanswered",
  "message_unmatched",
  "followup_due",
  "snooze_expired",
  "callback_requested",
  "approval_pending",
  "invoice_action",
  "visit_rebook",
  "variation_pending",
  "signoff_due",
  "broadcast_incomplete",
  "consent_missing",
  /** Assistant S6: a customer asked for a change on a SENT estimate. */
  "change_request",
  /** Assistant S7: a customer is waiting for a person in a live chat. */
  "handoff_requested",
  /** Visit booking addendum A §4.1: a Victorian suburb the zone list does not know. */
  "unmapped_suburb",
  /** Visit booking addendum A §4.4: a request (time / visit before the range / call) waiting for a reply. */
  "visit_request",
  /** Visit booking addendum A §4.4: it is November and next year's public holidays are not in Settings yet. */
  "holidays_next_year",
  /** S5 (R22): the customer declined the calendar invitation; the visit is cancelled and the slot reopened. */
  "visit_declined",
  /** S5 (R27): Tom moved the visit in Google Calendar; the platform did not follow — confirm the new time with the customer. */
  "visit_moved_in_google",
  /** S5 (4.6): Google Calendar writes keep failing for an estimator. */
  "gcal_sync_failed",
  /** S5 (4.6): a zone's estimator has no connected Google Calendar we can write to, so customers there cannot book. */
  "estimator_calendar_missing",
  /** Buckets brief §4: a wizard session that asked for a call or a visit (A). */
  "wizard_ready",
  /** Buckets brief §4: a wizard session that asked a question or for help (B). */
  "wizard_help",
  /** Standards Step 2 (⚑17): a painter has not confirmed the finish standards after the grace period. */
  "standards_unsigned",
  /** Call backs Step 3 (brief §8): the final walk-through flagged an area — is a call back required? */
  "walkthrough_flagged",
  /** Call backs: open with no return visit booked. */
  "callback_unbooked",
  /** Call backs: the return visit is today or tomorrow. */
  "callback_visit_soon",
  /** Call backs: the painter marked it fixed — confirm and close. */
  "callback_fixed",
  /** Buckets brief §4: priced, idle, nothing asked (C+). */
  "wizard_priced",
  /** CRM v2 P1: a sent estimate passed its valid_until — chase or close? Lapsed is not lost (decision 8.11). */
  "estimate_lapsed",
  /** CRM v2 P4: a "delayed until" date has passed — the note says what to do. */
  "delay_ended",
  /** Tom, 7 Sep: a customer attached condition photos — an estimator signs off the prep before the price is fixed. */
  "photo_review",
  /**
   * Estimator journey v2 §5 (⚑7, 9 Sep): a customer finished their estimate
   * and asked us to fix the price. THE point of the plan — a job quoted
   * without anybody driving to it. Before this the customer's "finalise my
   * price" wrote a prep pack and raised nothing anyone would ever see.
   */
  "desk_check",
  /** Session 1 (16 Sep): automatic job messages the office chose to approve first. */
  "message_approval",
  /** Airtable handover (16 Sep): a signed PaintScout job arrived through the Zap with its price but no per-area hours — type them from the PaintScout work order. */
  "hours_to_confirm",
  /**
   * Employed painters (S3, ruling 11): an employee flagged "can't make it"
   * on a scheduled day — or marked sick over one. The assignment stays as
   * it was; the office reassigns. Critical: a job with nobody on it.
   */
  "employee_reassign",
  /** S7 (brief §3.9): an assignment nobody has tapped Accept on, starting within a day — ring them. */
  "employee_unaccepted",
  /** S7: an employee asked for leave or an RDO — approve or decline before the day. */
  "leave_request",
  /**
   * Tom, 25 Sep 2026: ring the customer part-way through a job — half way on
   * a 3–6 day job, 35% and 70% on a longer one. High importance: a customer
   * mid-job with a question nobody asked for is how a review goes wrong.
   */
  "job_checkin",
  /** Tom, 25 Sep 2026: a 1–2 day job is done — ring and check they are happy. */
  "job_followup",
  /**
   * Tom, 1 Oct 2026: the office is HOLDING a painter's days (pink on the
   * board) while the client decides, and the days are now close. Book it or
   * release it — the hold is the reminder, this is the nudge.
   */
  "hold_pending",
  /**
   * Painter status Step 7 (brief §8): a painter dropped to Orange (ring them)
   * or Red (the owner is told too and must clear them before new offers); a
   * bonus review is due ("Tell Tom"); a qualifying job changed after a review
   * was raised (owner reviews); a Green painter's fast payment is on hold.
   */
  "painter_orange",
  "painter_red",
  "bonus_due",
  "bonus_changed",
  "payment_hold",
] as const;

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export type WorkItemBucket = "overdue" | "today" | "waiting";

export type SubjectRef = {
  type: "account" | "estimate" | "invoice" | "work_order" | "visit" | "event" | "campaign_queue" | "thread" | "wizard_session" | "contractor";
  id: string;
};

export type WorkItem = {
  /** P7: the customer's owner (accounts.owner_id), for the mine / everyone scope. */
  ownerId?: string | null;
  /** Deterministic and stable across recomputes — §3.4. Same fact, same key,
   *  every time, or dismissals and read-state break. */
  key: string;
  kind: WorkItemKind;
  /** Null only where the record genuinely has no account — an invoice on one
   *  of the pre-spine estimates that never captured contact. The brief types
   *  this as required; reality on this database does not, and pretending
   *  otherwise would silently drop real money items. */
  accountId: string | null;
  subjectRef: SubjectRef;
  title: string;
  /** One line of context, drawn from the record. */
  detail: string;
  /** When it became outstanding. */
  since: string;
  /** When it goes overdue. Null = no deadline, it just waits. */
  dueAt: string | null;
  bucket: WorkItemBucket;
  priority: number;
  /**
   * C7b — what is at stake, in cents, when the record knows it.
   *
   * The evaluator has always HAD this: `finish()` takes it as a
   * `PriorityInput` and folds it into `priority`, which is what orders the
   * queue. It then threw the number away, so a surface that wanted to SHOW
   * the figure had to go and fetch it again — a second query against the same
   * rows the queue had just read, which is exactly the duplication C7b exists
   * to remove. Keeping it costs one assignment.
   *
   * Null where the record genuinely has no figure (a message, a consent gap),
   * not as a stand-in for "not looked up".
   */
  valueCents: number | null;
  /** Exactly one action. An item offering three choices is an item nobody
   *  has decided the shape of. */
  action: { label: string; href: string };
};

// ---- keys (§3.4) -----------------------------------------------------------

export function itemKey(kind: WorkItemKind, subjectType: SubjectRef["type"], subjectId: string, discriminator: string): string {
  return `${kind}:${subjectType}:${subjectId}:${discriminator}`;
}

// ---- priority (§3.6) -------------------------------------------------------

/**
 * Which kinds the customer can see going unanswered. An unanswered question
 * beats an internal approval; chasing our own money or approving our own
 * campaign is ours to schedule.
 */
const CUSTOMER_VISIBLE: ReadonlySet<WorkItemKind> = new Set([
  "message_unanswered",
  "callback_requested",
  "visit_rebook",
  "signoff_due",
  "change_request",
  "handoff_requested",
  "wizard_ready",
  "wizard_help",
  "visit_request",
  "visit_declined",
  "visit_moved_in_google",
  "photo_review",
  "job_checkin",
  "job_followup",
]);

export function isCustomerVisible(kind: WorkItemKind): boolean {
  return CUSTOMER_VISIBLE.has(kind);
}

/**
 * Where a kind is WORKED (Tom, 6 Oct 2026: "move all job check-ins out of the
 * CRM system and into PC Command"). Still one evaluator and one set of
 * dismissals — a kind homed on "pc" is built here, keyed here and dismissed
 * through crm_dismiss_work_item like any other; it is simply shown on the PC
 * console (`buildPcWorkItems`) and left off Today, the tab badge and the home
 * dashboard (`crmItems`). Two queues would be a single-source violation; two
 * SCREENS over one queue is not.
 */
export type WorkItemHome = "crm" | "pc";
const PC_HOMED: ReadonlySet<WorkItemKind> = new Set(["job_checkin", "job_followup", "standards_unsigned", "walkthrough_flagged", "callback_unbooked", "callback_visit_soon", "callback_fixed", "painter_orange", "painter_red", "bonus_due", "bonus_changed", "payment_hold"]);
export function homeOf(kind: WorkItemKind): WorkItemHome {
  return PC_HOMED.has(kind) ? "pc" : "crm";
}
/** The items the CRM shows: everything not homed on the PC console. */
export function crmItems(items: readonly WorkItem[]): WorkItem[] {
  return items.filter((i) => homeOf(i.kind) === "crm");
}
/** The items PC Command shows. */
export function pcItems(items: readonly WorkItem[]): WorkItem[] {
  return items.filter((i) => homeOf(i.kind) === "pc");
}

/**
 * ⚑7.2 — these weights are defaults chosen to be defensible, not ruled. They
 * live in one object so Tom's ruling is a one-line change and not a hunt.
 */
export const KIND_WEIGHT: Record<WorkItemKind, number> = {
  painter_red: 28,
  painter_orange: 24,
  bonus_changed: 16,
  bonus_due: 12,
  payment_hold: 16,
  standards_unsigned: 14,
  walkthrough_flagged: 24,
  callback_unbooked: 18,
  callback_visit_soon: 10,
  callback_fixed: 18,
  unmapped_suburb: 16,
  visit_request: 24,
  holidays_next_year: 8,
  visit_declined: 22,
  visit_moved_in_google: 20,
  gcal_sync_failed: 14,
  estimator_calendar_missing: 18,
  message_unanswered: 26,
  callback_requested: 24,
  message_unmatched: 18,
  visit_rebook: 22,
  signoff_due: 20,
  snooze_expired: 16,
  followup_due: 14,
  invoice_action: 18,
  variation_pending: 16,
  approval_pending: 10,
  broadcast_incomplete: 6,
  consent_missing: 4,
  change_request: 24,
  handoff_requested: 30,
  wizard_ready: 26,
  wizard_help: 28,
  photo_review: 24,
  // A customer was promised a fixed price by the next working day and is
  // waiting on it. Ranks with the other promised-to-customer work.
  desk_check: 26,
  wizard_priced: 12,
  estimate_lapsed: 18,
  delay_ended: 20,
  // A customer or painter is expecting this message; it outranks a campaign step.
  message_approval: 20,
  // A job cannot be offered to a painter with no hours on it.
  hours_to_confirm: 18,
  // A booked day with no painter on it — outranks every internal chase.
  employee_reassign: 32,
  // A job starting tomorrow that its painter may not know about — a phone call.
  employee_unaccepted: 26,
  // A yes/no before the day, and then the board is right.
  leave_request: 12,
  // Payroll waits on this, but a day, not an hour.
  // Tom, 25 Sep: mid-job check-ins are HIGH importance — top of the customer band.
  job_checkin: 30,
  // A courtesy call after a short job; ranks with the other follow-ups.
  job_followup: 14,
  // Days reserved for a client who hasn't said yes — chase them before the painter loses the week.
  hold_pending: 16,
};

export type PriorityInput = {
  kind: WorkItemKind;
  /** Value at stake in cents, when the record knows it. */
  valueCents: number | null;
  /** Days past dueAt (0 when not yet due). */
  overdueDays: number;
  /** A dated commitment recorded to the customer — "breakdown by the 10th". */
  promisedToCustomer: boolean;
};

/**
 * One pure function. Two rules that aren't negotiable, both under test:
 *  - A promise made to a customer outranks value. The promise band (+100) is
 *    unreachable by the value term, which is capped at 25.
 *  - Anything customer-visible outranks anything internal at equal urgency:
 *    the visibility band (+40) exceeds the whole spread of kind weights.
 */
export function priorityOf(input: PriorityInput): number {
  let score = KIND_WEIGHT[input.kind];
  if (isCustomerVisible(input.kind)) score += 40;
  if (input.promisedToCustomer) score += 100;
  score += Math.min(Math.max(input.overdueDays, 0), 14) * 2;
  if (input.valueCents != null) score += Math.min(input.valueCents / 100_000, 25); // $1k → 1 point, capped
  return score;
}

// ---- buckets ---------------------------------------------------------------

const MELBOURNE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
});

/** The office's calendar day, not the server's. */
export function melbourneDay(d: Date): string {
  return MELBOURNE_DAY.format(d);
}

/**
 * Overdue = the deadline day has passed; today = it is that day (or the item
 * is actionable now with no deadline); waiting = the ball is with them.
 */
export function bucketFor(dueAt: string | null, now: Date): WorkItemBucket {
  if (!dueAt) return "today";
  const due = new Date(dueAt);
  const dueDay = melbourneDay(due);
  const nowDay = melbourneDay(now);
  if (dueDay < nowDay) return "overdue";
  if (dueDay > nowDay) return "waiting";
  return "today";
}

export function overdueDays(dueAt: string | null, now: Date): number {
  if (!dueAt) return 0;
  const ms = now.getTime() - new Date(dueAt).getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

// ---- filter groups (Today's chips, §4.2) -----------------------------------

export const FILTER_GROUPS = ["all", "messages", "followups", "approvals", "money"] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

export const GROUP_OF_KIND: Record<WorkItemKind, Exclude<FilterGroup, "all">> = {
  painter_red: "followups",
  painter_orange: "followups",
  bonus_due: "approvals",
  bonus_changed: "approvals",
  payment_hold: "money",
  standards_unsigned: "approvals",
  walkthrough_flagged: "approvals",
  callback_unbooked: "followups",
  callback_visit_soon: "followups",
  callback_fixed: "approvals",
  unmapped_suburb: "followups",
  visit_request: "followups",
  holidays_next_year: "approvals",
  visit_declined: "followups",
  visit_moved_in_google: "followups",
  gcal_sync_failed: "approvals",
  estimator_calendar_missing: "approvals",
  message_unanswered: "messages",
  message_unmatched: "messages",
  callback_requested: "messages",
  followup_due: "followups",
  snooze_expired: "followups",
  visit_rebook: "followups",
  approval_pending: "approvals",
  variation_pending: "approvals",
  signoff_due: "approvals",
  broadcast_incomplete: "approvals",
  consent_missing: "approvals",
  invoice_action: "money",
  change_request: "messages",
  handoff_requested: "messages",
  wizard_ready: "followups",
  wizard_help: "followups",
  wizard_priced: "followups",
  photo_review: "approvals",
  // It is a price to approve and send, not a follow-up to chase.
  desk_check: "approvals",
  estimate_lapsed: "followups",
  delay_ended: "followups",
  message_approval: "approvals",
  hours_to_confirm: "approvals",
  employee_reassign: "followups",
  employee_unaccepted: "followups",
  leave_request: "approvals",
  job_checkin: "followups",
  job_followup: "followups",
  hold_pending: "followups",
};

// ---- source: customer check-ins on a running job (Tom, 25 Sep 2026) ----------

export type JobCheckinRow = {
  id: string; wo_ref: string; stage: string; start_date: string | null; end_date: string | null;
  wo_snapshot: { jobTitle?: string | null; jobAddress?: string | null } | null;
  estimates: { account_id: string | null; accepted_name: string | null; title: string | null } | null;
  contractors: { company_name: string | null; works_saturday: boolean | null; works_sunday: boolean | null; profiles: { name: string | null } | null } | null;
};

const MELB_DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const melbInstant = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return melbourneInstant(y, m, d, hour, minute);
};

/**
 * The office's check-ins with the customer, derived from the booking and the
 * stage — never stored (the one-work-queue rule). The moments come from
 * lib/workorder/jobRhythm.ts, the same planner the painter's reminder texts
 * use, so "half way" means the same day to both.
 *
 *   · mid-job (3+ day jobs): listed from the morning of that day while the
 *     job is under way; due by 5 pm; gone when the job closes or the office
 *     dismisses it from the queue;
 *   · after a 1–2 day job: due the next business morning after the last
 *     booked day, once the job has passed that day; kept for ten days.
 */
export function buildJobCheckinItems(rows: readonly JobCheckinRow[], now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  const today = MELB_DAY_KEY.format(now);
  for (const w of rows) {
    if (w.stage === "offered") continue;
    const days = jobDays(w.start_date, w.end_date, {
      worksSaturday: Boolean(w.contractors?.works_saturday), worksSunday: Boolean(w.contractors?.works_sunday),
    });
    if (days.length === 0) continue;
    const customer = w.estimates?.accepted_name?.trim() || w.estimates?.title?.trim() || "The customer";
    const where = w.wo_snapshot?.jobAddress || w.wo_snapshot?.jobTitle || w.wo_ref;
    const painter = w.contractors?.profiles?.name || w.contractors?.company_name || null;
    const href = `/pc/wo/${w.id}`;
    for (const c of customerCheckins(days)) {
      if (c.kind === "mid") {
        if (w.stage === "closed") continue;
        if (today < c.date) continue;               // not yet that day
        if (c.date < days[0]) continue;
        const dueAt = melbInstant(c.date, 17).toISOString();
        items.push(finish({
          key: itemKey("job_checkin", "work_order", w.id, c.id),
          kind: "job_checkin",
          accountId: w.estimates?.account_id ?? null,
          subjectRef: { type: "work_order", id: w.id },
          title: `${customer} — mid-job check-in (${c.pct}% through, ${dayLabel(days, c.date)})`,
          detail: `${w.wo_ref} · ${where}${painter ? ` · ${painter} on site` : ""}. Ring them: how is it going, anything they have noticed? HIGH IMPORTANCE.`,
          since: melbInstant(c.date, 8).toISOString(),
          dueAt,
          action: { label: "Ring them", href },
        }, { valueCents: null, promisedToCustomer: false }, now));
      } else {
        // After the job: once its last booked day has passed (or it closed).
        if (w.stage !== "closed" && today <= c.date) continue;
        const due = nextBusinessMorning(melbInstant(c.date, 17));
        if (now.getTime() - due.getTime() > 10 * 86_400_000) continue;   // ten days, then it is history
        items.push(finish({
          key: itemKey("job_followup", "work_order", w.id, c.id),
          kind: "job_followup",
          accountId: w.estimates?.account_id ?? null,
          subjectRef: { type: "work_order", id: w.id },
          title: `${customer} — job done, check they are happy`,
          detail: `${w.wo_ref} · ${where} · a ${days.length}-day job${painter ? ` by ${painter}` : ""}. A quick call: happy with everything, anything to put right?`,
          since: melbInstant(c.date, 17).toISOString(),
          dueAt: due.toISOString(),
          action: { label: "Ring them", href },
        }, { valueCents: null, promisedToCustomer: false }, now));
      }
    }
  }
  return items;
}

// ---- source: employee_reassign (employed painters S3, ruling 11) ------------

export type CantMakeItEventRow = {
  id: string;
  work_order_id: string;
  created_at: string;
  meta: { assignment_id?: string; contractor_id?: string; start_date?: string; end_date?: string; reason?: string } | null;
  work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
};
export type ActiveAssignmentRow = {
  id: string; contractor_id: string; start_date: string; end_date: string; status: string;
  /** S7: present when the read carries them — the unaccepted item needs the job and the tap. */
  work_order_id?: string; accepted_at?: string | null;
  work_orders?: { wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
};
export type LeaveRequestRow = {
  id: string; contractor_id: string; kind: string; start_date: string; end_date: string; reason: string; created_at: string;
};
export type DatesChangedEventRow = { created_at: string; meta: { assignment_id?: string } | null };

/**
 * One item per assignment with a STANDING flag: the painter said they can't
 * make it, and the office has not since moved their dates or taken them off.
 * Derived from wo_events + wo_assignments, never stored; the key is the
 * assignment so a second flag on the same days does not resurrect a dismissal.
 */
export function buildEmployeeReassignItems(
  flags: CantMakeItEventRow[],
  active: ActiveAssignmentRow[],
  moves: DatesChangedEventRow[],
  painterNames: Map<string, string>,
  now: Date,
): WorkItem[] {
  const activeById = new Map(active.filter((a) => a.status !== "released").map((a) => [a.id, a]));
  const lastMove = new Map<string, string>();
  for (const m of moves) {
    const id = m.meta?.assignment_id;
    if (!id) continue;
    const seen = lastMove.get(id);
    if (!seen || m.created_at > seen) lastMove.set(id, m.created_at);
  }
  const latestFlag = new Map<string, CantMakeItEventRow>();
  for (const f of flags) {
    const id = f.meta?.assignment_id;
    if (!id || !activeById.has(id)) continue;
    const moved = lastMove.get(id);
    if (moved && moved >= f.created_at) continue; // the office already answered this one
    const seen = latestFlag.get(id);
    if (!seen || f.created_at > seen.created_at) latestFlag.set(id, f);
  }
  return [...latestFlag.entries()].map(([assignmentId, f]) => {
    const a = activeById.get(assignmentId)!;
    const who = painterNames.get(a.contractor_id) ?? "A painter";
    const job = f.work_orders?.wo_snapshot?.jobTitle || f.work_orders?.wo_ref || "a job";
    const dmy = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
    const days = a.start_date === a.end_date ? dmy(a.start_date) : `${dmy(a.start_date)}–${dmy(a.end_date)}`;
    return finish({
      key: itemKey("employee_reassign", "work_order", f.work_order_id, assignmentId),
      kind: "employee_reassign",
      accountId: null,
      subjectRef: { type: "work_order", id: f.work_order_id },
      title: `${who} can't make ${job} — ${days}`,
      detail: [f.meta?.reason ? `"${f.meta.reason}"` : "", "Nothing has changed on the job — reassign the days or take them off."].filter(Boolean).join(" · "),
      since: f.created_at,
      // Due the day before their first day (Melbourne midnight, offset measured
      // from the zone — never written down), so it sits in Overdue once that passes.
      dueAt: new Date(Date.parse(melbourneDayStartUtc(new Date(`${a.start_date}T12:00:00Z`))) - 86_400_000).toISOString(),
      action: { label: "Reassign", href: `/pc/schedule?from=${a.start_date}&days=14` },
    }, { valueCents: null, promisedToCustomer: false }, now);
  });
}

// ---- sources: employee_unaccepted · leave_request (S7, brief §3.9) ----

const dmyOf = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const daysOf = (start: string, end: string) => start === end ? dmyOf(start) : `${dmyOf(start)}–${dmyOf(end)}`;

/**
 * An assignment with no Accept on it whose first day starts within 24 hours
 * (Melbourne midnight, measured from the zone). Amber: the painter may not
 * know. Clears the moment they tap Accept, their dates move, or the day is
 * past — nothing is stored.
 */
export function buildEmployeeUnacceptedItems(active: ActiveAssignmentRow[], painterNames: Map<string, string>, now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const a of active) {
    if (a.status !== "assigned" || a.accepted_at || !a.work_order_id) continue;
    const startsAt = Date.parse(melbourneDayStartUtc(new Date(`${a.start_date}T12:00:00Z`)));
    const endsAt = Date.parse(melbourneDayStartUtc(new Date(`${a.end_date}T12:00:00Z`))) + 86_400_000;
    if (startsAt - now.getTime() > 86_400_000 || endsAt <= now.getTime()) continue;
    const who = painterNames.get(a.contractor_id) ?? "A painter";
    const job = a.work_orders?.wo_snapshot?.jobTitle || a.work_orders?.wo_ref || "a job";
    items.push(finish({
      key: itemKey("employee_unaccepted", "work_order", a.work_order_id, a.id),
      kind: "employee_unaccepted",
      accountId: null,
      subjectRef: { type: "work_order", id: a.work_order_id },
      title: `${who} hasn't accepted ${job} — ${daysOf(a.start_date, a.end_date)}`,
      detail: "No tap on the assignment yet. Ring them: they may not know they're on it.",
      since: now.toISOString(),
      dueAt: new Date(startsAt).toISOString(),
      action: { label: "Call painter", href: "/contractors" },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- source: hold_pending (Tom, 1 Oct 2026) ---------------------------------

export type HoldQueueRow = {
  id: string; contractor_id: string; start_date: string; end_date: string;
  work_order_id: string | null; note: string; created_at: string; released_at: string | null;
  work_orders: { wo_ref: string | null; wo_snapshot: { jobTitle?: string | null } | null } | null;
};

/** How far ahead a hold starts nagging. A week: long enough to ring the client twice. */
export const HOLD_NUDGE_DAYS = 7;

/**
 * One item per open hold whose first day is within a week (or has begun and
 * not yet passed). A hold answered by a booking of its job — to anyone — is
 * resolved and raises nothing; so is a released one. Due two days before the
 * first held day, so it lands in Overdue with time to re-offer the week.
 */
export function buildHoldItems(rows: readonly HoldQueueRow[], bookedWorkOrderIds: ReadonlySet<string>, painterNames: Map<string, string>, now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const h of openHolds(rows, bookedWorkOrderIds)) {
    const startsAt = Date.parse(melbourneDayStartUtc(new Date(`${h.start_date}T12:00:00Z`)));
    const endsAt = Date.parse(melbourneDayStartUtc(new Date(`${h.end_date}T12:00:00Z`))) + 86_400_000;
    if (startsAt - now.getTime() > HOLD_NUDGE_DAYS * 86_400_000 || endsAt <= now.getTime()) continue;
    const who = painterNames.get(h.contractor_id) ?? "A painter";
    const job = h.work_orders?.wo_snapshot?.jobTitle || h.work_orders?.wo_ref || null;
    items.push(finish({
      key: itemKey("hold_pending", h.work_order_id ? "work_order" : "event", h.work_order_id ?? h.id, h.id),
      kind: "hold_pending",
      accountId: null,
      subjectRef: h.work_order_id ? { type: "work_order", id: h.work_order_id } : { type: "event", id: h.id },
      title: `${who}'s days are held${job ? ` for ${job}` : ""} — ${daysOf(h.start_date, h.end_date)}`,
      detail: h.note ? `"${h.note}" — book it or release the days.` : "Waiting on the client. Book it or release the days — it's the pink block on the board.",
      since: h.created_at,
      dueAt: new Date(startsAt - 2 * 86_400_000).toISOString(),
      action: { label: "Open the board", href: `/pc/schedule?from=${h.start_date}&days=14` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

/** One item per leave / RDO request still undecided. Due the day before it starts. */
export function buildLeaveRequestItems(rows: LeaveRequestRow[], painterNames: Map<string, string>, now: Date): WorkItem[] {
  return rows.map((r) => {
    const who = painterNames.get(r.contractor_id) ?? "A painter";
    const what = r.kind === "rdo" ? "an RDO" : "leave";
    return finish({
      key: itemKey("leave_request", "event", r.id, r.kind),
      kind: "leave_request",
      accountId: null,
      subjectRef: { type: "event", id: r.id },
      title: `${who} asked for ${what} — ${daysOf(r.start_date, r.end_date)}`,
      detail: r.reason ? `"${r.reason}"` : "No reason given.",
      since: r.created_at,
      dueAt: new Date(Date.parse(melbourneDayStartUtc(new Date(`${r.start_date}T12:00:00Z`))) - 86_400_000).toISOString(),
      action: { label: "Decide", href: "/pc/timesheets#time-off" },
    }, { valueCents: null, promisedToCustomer: false }, now);
  });
}

// Tom, 7 Oct 2026: there is no timesheet_approval item any more — days approve
// themselves on submit (migration 20270219); the office is not reminded to approve.

// ---- source: snooze_expired (§3.3) -----------------------------------------

export type SnoozeAccountRow = {
  id: string;
  name: string | null;
  email: string | null;
  snoozed_until: string | null;
  followup_due_at: string | null;
  followup_note: string | null;
};

export type SnoozeReasonRow = { account_id: string; payload: { reason?: string } | null; occurred_at: string };

/**
 * A staff-set date has passed — a snooze ("call late Aug") or a follow-up
 * reminder. Both are the office's own written intent coming due, which is why
 * a reminder with a note counts as a promise: someone told the customer
 * something would happen by then, and wrote it down.
 */
export function buildSnoozeItems(accounts: SnoozeAccountRow[], reasons: SnoozeReasonRow[], now: Date): WorkItem[] {
  const reasonOf = new Map<string, string>();
  for (const r of reasons) {
    // Rows arrive newest-first; keep the first (latest) reason per account.
    if (!reasonOf.has(r.account_id) && r.payload?.reason) reasonOf.set(r.account_id, r.payload.reason);
  }

  const items: WorkItem[] = [];
  for (const a of accounts) {
    const who = a.name || a.email;
    if (a.snoozed_until && new Date(a.snoozed_until) <= now) {
      const reason = reasonOf.get(a.id);
      const due = a.snoozed_until;
      items.push(finish({
        key: itemKey("snooze_expired", "account", a.id, "snooze"),
        kind: "snooze_expired",
        accountId: a.id,
        subjectRef: { type: "account", id: a.id },
        title: `${who} — snooze expired`,
        detail: reason ? `You noted: “${reason}”` : "Snoozed with no note. It's back.",
        since: due,
        dueAt: due,
        action: { label: "Open", href: `/crm/customers/${a.id}` },
      }, { valueCents: null, promisedToCustomer: false }, now));
    }
    if (a.followup_due_at && new Date(a.followup_due_at) <= now) {
      const due = a.followup_due_at;
      items.push(finish({
        key: itemKey("snooze_expired", "account", a.id, "reminder"),
        kind: "snooze_expired",
        accountId: a.id,
        subjectRef: { type: "account", id: a.id },
        title: `${who} — follow-up reminder due`,
        detail: a.followup_note || "Reminder set with no note.",
        since: due,
        dueAt: due,
        action: { label: "Open", href: `/crm/customers/${a.id}` },
      }, { valueCents: null, promisedToCustomer: !!a.followup_note?.trim() }, now));
    }
  }
  return items;
}

// ---- source: invoice_action (§3.3) -----------------------------------------

export type QueueInvoiceRow = DeriveInvoice & {
  accountId: string | null;
  customerName: string | null;
  jobAddress: string | null;
};

/**
 * Deposit unpaid, invoice overdue. The judgement calls are lib/invoicing's —
 * `invoiceIsOverdue` and `invoiceBalanceCents` decide, this function only
 * phrases. This IS the old invoicing attention surface, generalised; the
 * dashboard keeps its tiles (they are figures, not a to-do list) but the
 * to-do half lives only here.
 */
export function buildInvoiceItems(invoices: QueueInvoiceRow[], payments: DerivePayment[], now: Date): WorkItem[] {
  const todayIso = now.toISOString().slice(0, 10);
  const items: WorkItem[] = [];
  for (const inv of invoices) {
    const balance = invoiceBalanceCents(inv, payments);
    if (balance <= 0) continue;
    const who = inv.customerName || inv.jobAddress || "a job";
    const money = "$" + Math.round(balance / 100).toLocaleString("en-AU");
    const overdue = invoiceIsOverdue(inv, payments, todayIso);
    const href = inv.accountId ? `/crm/customers/${inv.accountId}` : `/invoicing/job/${inv.estimateId}`;

    if (inv.kind === "deposit") {
      items.push(finish({
        key: itemKey("invoice_action", "invoice", inv.id, "deposit"),
        kind: "invoice_action",
        accountId: inv.accountId,
        subjectRef: { type: "invoice", id: inv.id },
        title: `${who} — deposit unpaid`,
        detail: `${money} outstanding. The job shouldn't start without it.`,
        since: inv.issuedOn ?? todayIso,
        dueAt: inv.dueOn,
        action: { label: "Chase", href },
      }, { valueCents: balance, promisedToCustomer: false }, now));
    } else if (overdue) {
      items.push(finish({
        key: itemKey("invoice_action", "invoice", inv.id, "overdue"),
        kind: "invoice_action",
        accountId: inv.accountId,
        subjectRef: { type: "invoice", id: inv.id },
        title: `${who} — invoice overdue`,
        detail: `${money} past its due date.`,
        since: inv.dueOn ?? todayIso,
        dueAt: inv.dueOn,
        action: { label: "Chase", href },
      }, { valueCents: balance, promisedToCustomer: false }, now));
    }
  }
  return items;
}

// ---- source: callback_requested (§3.3) -------------------------------------

export type CallbackEventRow = {
  id: string;
  account_id: string;
  occurred_at: string;
  payload: { phone?: string; note?: string } | null;
};

export type ContactEventRow = { account_id: string; occurred_at: string };

/**
 * Tom, 7 Oct 2026: "if a job is accepted, remove all follow-ups from the CRM
 * automatically." The stored reminder is cleared by the database trigger
 * (migration 20270219); the DERIVED follow-ups — a quiet quote, a callback, an
 * online estimate — are answered here: anything that was asked for at or
 * before the customer's latest acceptance is no longer waiting on the office.
 */
export function answeredByAcceptance(acceptedAt: Map<string, string>, accountId: string | null | undefined, askedAt: string): boolean {
  if (!accountId) return false;
  const at = acceptedAt.get(accountId);
  return !!at && at >= askedAt;
}

/** ⚑7.8 default — a callback goes overdue after this many hours. */
export const CALLBACK_OVERDUE_HOURS = 4;

/**
 * A callback form submitted, not yet called. "Called" means any logged call
 * attempt after the request — connected, no answer or message left. The item
 * dies the moment the attempt is logged, which is the derivation rule doing
 * its job.
 */
export function buildCallbackItems(
  callbacks: CallbackEventRow[],
  attempts: ContactEventRow[],
  accountNames: Map<string, string>,
  now: Date,
  acceptedAt: Map<string, string> = new Map(),
): WorkItem[] {
  const items: WorkItem[] = [];
  for (const cb of callbacks) {
    const answered = attempts.some((a) => a.account_id === cb.account_id && a.occurred_at > cb.occurred_at);
    if (answered) continue;
    if (answeredByAcceptance(acceptedAt, cb.account_id, cb.occurred_at)) continue;
    const who = accountNames.get(cb.account_id) ?? "Someone";
    const note = cb.payload?.note;
    const phone = cb.payload?.phone;
    const due = new Date(new Date(cb.occurred_at).getTime() + CALLBACK_OVERDUE_HOURS * 3_600_000).toISOString();
    items.push(finish({
      key: itemKey("callback_requested", "event", cb.id, "call"),
      kind: "callback_requested",
      accountId: cb.account_id,
      subjectRef: { type: "event", id: cb.id },
      title: `${who} requested a call`,
      detail: [note, phone].filter(Boolean).join(" · ") || "No note with it — just the request.",
      since: cb.occurred_at,
      dueAt: due,
      action: { label: "Call", href: `/crm/customers/${cb.account_id}` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- source: visit_rebook (P6) ---------------------------------------------

export type RebookVisitRow = {
  id: string; account_id: string | null; status: string; starts_at: string; outcome_at: string | null; updated_at: string;
  customer_name: string | null; address: string | null; customer_phone: string | null; outcome_note: string | null;
};

/**
 * A visit that didn't happen — a no-show, or one the office marked "rebook" —
 * with no later booking for the same customer. Due the next business morning;
 * the customer is waiting on us to call.
 */
export function buildRebookItems(rows: RebookVisitRow[], laterBooked: Array<{ account_id: string | null; starts_at: string; created_at: string }>, now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const v of rows) {
    if (v.status !== "no_show" && v.status !== "rebook") continue;
    const since = v.outcome_at ?? v.updated_at;
    const rebooked = v.account_id && laterBooked.some((b) => b.account_id === v.account_id && b.created_at > since);
    if (rebooked) continue;
    const who = v.customer_name || "A customer";
    items.push(finish({
      key: itemKey("visit_rebook", "visit", v.id, v.status),
      kind: "visit_rebook",
      accountId: v.account_id,
      subjectRef: { type: "visit", id: v.id },
      title: v.status === "no_show" ? `${who} — visit was a no-show, rebook it` : `${who} — visit to rebook`,
      detail: [v.address, v.customer_phone, v.outcome_note].filter(Boolean).join(" · ") || "No note with it.",
      since,
      dueAt: nextBusinessMorning(new Date(since)).toISOString(),
      action: { label: "Rebook", href: v.account_id ? `/crm/customers/${v.account_id}` : "/crm/diary" },
    }, { valueCents: null, promisedToCustomer: true }, now));
  }
  return items;
}

// ---- source: wizard buckets A / B / C+ (buckets brief §4) -------------------

export type WizardQueueRow = {
  id: string; account_id: string | null; estimate_id: string | null;
  name: string | null; email: string | null; phone: string | null; address: string | null; suburb: string | null;
  job_type: string | null; bucket: string; outcome: string; outcome_at: string | null; outcome_note: string | null;
  dropped_at: string | null; furthest_page: number; pages_total: number; active_seconds: number;
  last_seen_at: string; est_value_cents: number | null; entry_source: string | null;
};

const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

/**
 * One item per session in bucket A, B or C+. The item dies when a call
 * attempt is logged on the account after the request (the callback rule),
 * when the session moves on, or when it is dismissed. Due dates are office
 * hours in Melbourne: 4 for a call or visit request, 2 for help, the next
 * business morning for "priced, no request".
 */
export function buildWizardItems(rows: WizardQueueRow[], attempts: ContactEventRow[], now: Date, acceptedAt: Map<string, string> = new Map()): WorkItem[] {
  const items: WorkItem[] = [];
  for (const r of rows) {
    const bucket = r.bucket as WizardBucket;
    const since = r.outcome_at ?? r.dropped_at ?? r.last_seen_at;
    if (r.account_id && attempts.some((a) => a.account_id === r.account_id && a.occurred_at > since)) continue;
    if (answeredByAcceptance(acceptedAt, r.account_id, since)) continue;
    const who = journeyWho(r);
    const where = r.address || r.suburb || "";
    const line = journeyLine({ furthestPage: r.furthest_page, pagesTotal: r.pages_total, activeSeconds: r.active_seconds, lastActiveAt: r.last_seen_at }, now);
    const href = r.account_id ? `/crm/customers/${r.account_id}` : r.estimate_id ? `/quote?id=${r.estimate_id}` : `/estimates?status=wizard&open=${r.id}`;
    const base = { accountId: r.account_id, subjectRef: { type: "wizard_session" as const, id: r.id }, since };
    if (bucket === "ready_call" || bucket === "ready_visit") {
      const visit = bucket === "ready_visit";
      // Tom, 8 Sep: a visit booked from the wizard's help bar is already in
      // the Diary (a visits row, an invite sent) — the note says "Booked: …"
      // and no "book visit" card is raised on top of it.
      if (visit && (r.outcome_note ?? "").startsWith("Booked:")) continue;
      // Visit booking S4: a request made online is its own row (visit_requests) and its own card.
      if ((r.outcome_note ?? "").startsWith("Requested online:")) continue;
      items.push(finish({
        ...base,
        key: itemKey("wizard_ready", "wizard_session", r.id, visit ? "visit" : "call"),
        kind: "wizard_ready",
        title: visit ? `Book visit — ${who}` : `Call ${who} — confirm price`,
        detail: [where, line, r.phone].filter(Boolean).join(" · "),
        dueAt: addBusinessHours(new Date(since), 4).toISOString(),
        action: { label: visit ? "Book visit" : "Call", href },
      }, { valueCents: r.est_value_cents, promisedToCustomer: false }, now));
    } else if (bucket === "needs_help") {
      items.push(finish({
        ...base,
        key: itemKey("wizard_help", "wizard_session", r.id, r.outcome),
        kind: "wizard_help",
        title: `Reply to ${who} — stuck at ${pageLabel(r.job_type, r.furthest_page)}`,
        detail: [r.outcome_note, where, line, r.phone].filter(Boolean).join(" · ") || line,
        dueAt: addBusinessHours(new Date(since), 2).toISOString(),
        action: { label: "Reply", href },
      }, { valueCents: r.est_value_cents, promisedToCustomer: false }, now));
    } else if (bucket === "priced_no_request") {
      items.push(finish({
        ...base,
        key: itemKey("wizard_priced", "wizard_session", r.id, "priced"),
        kind: "wizard_priced",
        title: `Follow up ${who} — saw ${r.est_value_cents ? money(r.est_value_cents) : "their price"}`,
        detail: [where, bucketPill(bucket, r.job_type, r.furthest_page).label, line].filter(Boolean).join(" · "),
        dueAt: nextBusinessMorning(new Date(since)).toISOString(),
        action: { label: "Follow up", href },
      }, { valueCents: r.est_value_cents, promisedToCustomer: false }, now));
    }
  }
  return items;
}

// ---- source: photo_review (Tom, 7 Sep) -------------------------------------

export type PhotoReviewRow = {
  id: string; title: string | null; account_id: string | null; created_at: string; status: string;
  builder_state: { aiDeferred?: Array<{ kind?: string; count?: number }> } | null;
};

/**
 * One item per open estimate whose builder_state still carries the
 * photo_review deferral (the merge raises it for every customer condition
 * photo; the builder's "Signed off" button removes it). Due the next
 * business morning — the customer's range says "pending estimator sign-off"
 * until then.
 */
export function buildPhotoReviewItems(rows: PhotoReviewRow[], now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const r of rows) {
    const d = (r.builder_state?.aiDeferred ?? []).find((x) => x?.kind === "photo_review");
    if (!d) continue;
    const n = Number(d.count) || 1;
    items.push(finish({
      key: itemKey("photo_review", "estimate", r.id, "photos"),
      kind: "photo_review",
      accountId: r.account_id,
      subjectRef: { type: "estimate", id: r.id },
      since: r.created_at,
      title: `Sign off ${n} condition photo${n === 1 ? "" : "s"} — ${r.title?.trim() || "estimate"}`,
      detail: "Price any extra preparation from the customer's photos, then mark them signed off in the builder",
      dueAt: nextBusinessMorning(new Date(r.created_at)).toISOString(),
      action: { label: "Review photos", href: `/quote?id=${r.id}` },
    }, { valueCents: null, promisedToCustomer: true }, now));
  }
  return items;
}

// ---- source: desk_check (estimator journey v2 §5, ⚑7) ----------------------

/**
 * A row of `confirmation_requests`, joined to its estimate.
 *
 * C5 MOVED THE SOURCE. This used to be an estimate carrying
 * `builder_state.prepPack.kind = 'desk_check'` — a jsonb marker, found by
 * scanning estimates for it. The marker could not carry who it is assigned to,
 * what the rules suggested, the pack as sent, or any of the four Phase 1
 * metrics (§2.6), because it has no timestamps and no history: it is either
 * there or it is not. The queue derives from the table alone now, and the
 * migration backfilled every marker so nothing was lost in the move.
 */
export type DeskCheckRow = {
  id: string;
  estimate_id: string;
  requested_at: string;
  kind: string;
  status: string;
  suggested_action: "fix" | "ask" | "visit" | null;
  assigned_to: string | null;
  estimates: {
    title: string | null; account_id: string | null;
    /** `estimates.total_cents`, written by the builder on save — NOT
     * `total_inc_cents`, which is an invoices column. Selecting the wrong one
     * made the whole query error and the queue show nothing at all. */
    total_cents: number | null;
    builder_state: { blocks?: Array<{ kind?: string; type?: string }> } | null;
  } | null;
};

/**
 * One item per estimate whose customer has asked us to fix their price.
 *
 * The gap this closes: `accept_intent` has always written a prep pack and
 * pushed a deferral, and raised NOTHING on Today. The customer was told a
 * person would confirm their price, and no person was ever told.
 *
 * ⚑7 decides what the item ASKS FOR, never whether it exists. An eligible job
 * says "fix it without a visit"; one over the cap or carrying exterior work
 * says so and asks for a visit instead. Every job is still looked at by a
 * person — that is the difference between this and self-serve.
 */
export function buildDeskCheckItems(
  rows: DeskCheckRow[],
  policy: WizardPolicySettings,
  now: Date,
  /** What we told the customer (Settings `confirmation_turnaround`). */
  turnaround: TurnaroundSetting = DEFAULT_TURNAROUND_SETTING,
): WorkItem[] {
  const items: WorkItem[] = [];
  /**
   * Value × readiness (plan §2.6), from the one sorter in
   * lib/wizard/confirmation.ts — a fixable job outranks a bigger one that
   * still needs a visit, because it can become a signed job in minutes.
   * Deliberately not a time decay: an old job is not a valuable one, and the
   * turnaround warning chases age instead of letting it bury the work that pays.
   */
  const ordered = sortQueue(rows.map((r) => ({
    row: r,
    totalCents: Number(r.estimates?.total_cents) || 0,
    suggestedAction: r.suggested_action,
    requestedAt: r.requested_at,
  })));

  for (const { row: r, totalCents: total } of ordered) {
    const est = r.estimates;
    const hasExterior = (est?.builder_state?.blocks ?? [])
      .some((b: { kind?: string; type?: string }) => b?.kind === "area" && b?.type === "Exterior");
    /**
     * The verdict is re-derived HERE from the stored total, so the queue does
     * not price every candidate. It can lag a builder edit, which is why the
     * desk-check PAGE re-derives it live — that one is authoritative, this one
     * only orders and words the card.
     *
     * The row's own `kind` is what we PROMISED the customer at send. When the
     * two disagree, the promise is what the card says, because that is what the
     * customer was told — the estimator finds out why on the page.
     */
    const verdict = remoteConfirmVerdict(total, hasExterior, policy);
    const promisedRemote = r.kind === "remote";
    const since = r.requested_at ?? new Date(now).toISOString();
    const name = est?.title?.trim() || "estimate";
    items.push(finish({
      key: itemKey("desk_check", "estimate", r.estimate_id, "confirm"),
      kind: "desk_check",
      accountId: est?.account_id ?? null,
      subjectRef: { type: "estimate", id: r.estimate_id },
      since,
      title: verdict.eligible && promisedRemote
        ? `Fix the price without a visit — ${name}`
        : `Desk check, then book a visit — ${name}`,
      // The flagged-item count came off the old jsonb marker. It is not
      // reinvented here: the desk-check page lists every flag against the room
      // it belongs to, which is where somebody can act on it. A count on a card
      // that might disagree with the page is worse than no count.
      detail: (() => {
        const base = verdict.eligible && promisedRemote
          ? "The customer confirmed their scope and asked us to fix it."
          : promisedRemote
            ? `The customer asked us to fix it, but ${verdict.reason}.`
            : "The customer asked for a person to look at it.";
        // Past the promise: say so in the customer's own words, because that
        // is what they are holding us to.
        return isOverdue({ requestedAt: since, now, turnaroundHours: turnaround.hours })
          ? `${base} We said ${turnaround.words} — that has passed.`
          : base;
      })(),
      /**
       * C6 — due when we SAID it would be done, not on a generic next morning.
       *
       * The hand-off screen tells the customer a turnaround from
       * `confirmation_turnaround`; this counts the same business hours from the
       * same setting. One number, or the queue chases a different promise than
       * the one the customer was given — and the existing overdue bucket and
       * priority boost then do the rest, so there is no second warning
       * mechanism to keep in step.
       */
      dueAt: addBusinessHours(new Date(since), turnaround.hours).toISOString(),
      // C7b: the pack is a TAB on the estimate now, not a screen of its own —
      // "open the desk check" and "open the estimate" were two destinations
      // for one record.
      action: { label: "Open the pack", href: `/quote?id=${r.estimate_id}&tab=pack` },
    }, { valueCents: total || null, promisedToCustomer: true }, now));
  }
  return items;
}

// ---- source: approval_pending (§3.3, moved out of Campaigns per §2.4) ------

/**
 * One aggregate item, not one per message: the queue page is where they are
 * judged one by one, and ten near-identical cards here would drown the
 * customer-visible work below them. The key carries no count, so approving
 * one of three doesn't resurrect a dismissed item.
 */
/**
 * Session 1: automatic job messages waiting for a person (Settings →
 * Automations, "Office approves first"). One card, like the campaign queue —
 * derived from pending automation_holds rows, never stored.
 */
export function buildMessageApprovalItem(pendingCount: number, now: Date): WorkItem[] {
  if (pendingCount <= 0) return [];
  const n = pendingCount;
  return [finish({
    key: itemKey("message_approval", "campaign_queue", "automation_holds", "pending"),
    kind: "message_approval", accountId: null,
    subjectRef: { type: "campaign_queue", id: "automation_holds" },
    title: `${n} job message${n === 1 ? "" : "s"} waiting for approval`,
    detail: "Booking confirmations, reminders and painter texts the office chose to approve first. Nothing leaves until you say so.",
    since: now.toISOString(), dueAt: null,
    action: { label: n === 1 ? "Review" : "Review all", href: "/crm/messages/queue" },
  }, { valueCents: null, promisedToCustomer: false }, now)];
}

export function buildApprovalItem(queuedCount: number, now: Date): WorkItem[] {
  if (queuedCount <= 0) return [];
  const n = queuedCount;
  return [finish({
    key: itemKey("approval_pending", "campaign_queue", "campaign_messages", "pending"),
    kind: "approval_pending",
    accountId: null,
    subjectRef: { type: "campaign_queue", id: "campaign_messages" },
    title: `${n} campaign message${n === 1 ? "" : "s"} waiting for approval`,
    detail: "Nothing leaves until you say so. Approval re-runs the guard chain as of that second.",
    since: now.toISOString(),
    dueAt: null,
    action: { label: n === 1 ? "Review" : "Review all", href: "/crm/campaigns/queue" },
  }, { valueCents: null, promisedToCustomer: false }, now)];
}

// ---- source: unmapped_suburb (visit booking addendum A §4.1) -----------------

/** A row of `visit_unmapped_suburbs` with no `resolved_at`. */
export type UnmappedSuburbRow = {
  id: string;
  suburb: string;
  postcode: string;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
  last_estimate_id: string | null;
};

/**
 * One item per unknown Victorian suburb a customer typed. The fact is the row;
 * the item disappears when the suburb is added to the list in Settings (which
 * sets `resolved_at`). Due the next business morning — the customer went down
 * the request-a-time path and is waiting on a reply.
 */
export function buildUnmappedSuburbItems(rows: UnmappedSuburbRow[], now: Date): WorkItem[] {
  return rows.map((r) => {
    const where = `${r.suburb}${r.postcode ? ` ${r.postcode}` : ""}`;
    return finish({
      key: itemKey("unmapped_suburb", "event", r.id, "zone"),
      kind: "unmapped_suburb",
      accountId: null,
      subjectRef: r.last_estimate_id ? { type: "estimate", id: r.last_estimate_id } : { type: "event", id: r.id },
      since: r.first_seen_at,
      title: `Unmapped suburb: ${where}`,
      detail: `${r.hits === 1 ? "A customer" : `${r.hits} customers`} gave an address in ${where}, which is not in the visit zones list. Add it as a zone, pre-arranged or out of area so the next one gets an answer.`,
      dueAt: nextBusinessMorning(new Date(r.first_seen_at)).toISOString(),
      action: { label: "Add the suburb", href: "/settings#visit-zones" },
    }, { valueCents: null, promisedToCustomer: true }, now);
  });
}

// ---- source: visit_request + holidays_next_year (visit booking addendum A §4.4) --

/** A row of `visit_requests` with no `answered_at`. */
export type VisitRequestRow = {
  id: string;
  kind: "time" | "visit" | "call";
  account_id: string | null;
  estimate_id: string | null;
  zone: string;
  suburb: string | null;
  name: string;
  mobile: string | null;
  note: string | null;
  preferred_days: number[];
  time_of_day: string | null;
  created_at: string;
  due_at: string;
};

const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONE_WORDS: Record<string, string> = { zone_1: "Zone 1", zone_2: "Zone 2", zone_3: "Zone 3", zone_4: "Zone 4", zone_5: "Zone 5", pre_arranged: "pre-arranged area", out_of_area: "out of area", unmapped: "unmapped suburb" };

/**
 * One item per open request, due at the row's `due_at` — the end of the next
 * working day after it was made, public holidays excluded (R23, R33). Staff
 * answer it by offering a time, which books the slot and sets `answered_at`.
 */
export function buildVisitRequestItems(rows: VisitRequestRow[], now: Date): WorkItem[] {
  return rows.map((r) => {
    const where = [r.suburb, ZONE_WORDS[r.zone] ?? r.zone].filter(Boolean).join(", ");
    const prefs = r.kind === "time" && (r.preferred_days.length || r.time_of_day)
      ? ` — ${r.preferred_days.map((d) => DAY3[d] ?? "").filter(Boolean).join(" ")}${r.time_of_day ? `, ${r.time_of_day}` : ""}`
      : "";
    const title = r.kind === "call" ? `Call ${r.name} to finalise by phone` : r.kind === "visit" ? `Arrange a site visit — ${r.name}` : `Offer a visit time — ${r.name}`;
    return finish({
      key: itemKey("visit_request", "event", r.id, r.kind),
      kind: "visit_request",
      accountId: r.account_id,
      subjectRef: r.estimate_id ? { type: "estimate", id: r.estimate_id } : { type: "event", id: r.id },
      since: r.created_at,
      title,
      detail: [where, r.mobile, prefs ? `prefers${prefs}` : null, r.note].filter(Boolean).join(" · ") || "Reply within one working day",
      dueAt: r.due_at,
      action: { label: r.kind === "call" ? "Call" : "Offer a time", href: `/crm/visit-requests/${r.id}` },
    }, { valueCents: null, promisedToCustomer: true }, now);
  });
}

/** From 1 November, until next year's public holidays are in Settings → Booking rules. */
export function buildHolidaysItem(holidays: readonly string[], now: Date): WorkItem[] {
  if (!nextYearHolidaysMissing(holidays, now)) return [];
  const year = melbourneParts(now).y + 1;
  return [finish({
    key: itemKey("holidays_next_year", "event", `holidays-${year}`, "settings"),
    kind: "holidays_next_year",
    accountId: null,
    subjectRef: { type: "event", id: `holidays-${year}` },
    since: now.toISOString(),
    title: `Add the ${year} Victorian public holidays`,
    detail: "Booking rules has none for next year yet. Customers could book visits on a holiday and request replies would be due on one.",
    dueAt: null,
    action: { label: "Open Booking rules", href: "/settings#booking-rules" },
  }, { valueCents: null, promisedToCustomer: false }, now)];
}

// ---- source: Google Calendar (visit booking addendum A §4.6, S5) ----------------

export type DeclinedVisitRow = { id: string; account_id: string | null; estimate_id: string | null; starts_at: string; cancelled_at: string; cancel_reason: string | null; customer_name: string | null; suburb: string | null };
export type MovedVisitRow = { id: string; visit_id: string; staff_id: string; google_start: string; moved_seen_at: string; visit_start: string; account_id: string | null; estimate_id: string | null; customer_name: string | null; estimator_name: string | null };
export type GcalConnectionRow = { staff_id: string; google_email: string | null; sync_error: string | null; scopes: string | null; estimator_name: string | null };
export type ZoneEstimatorRow = { key: string; estimator_id: string | null; estimator_name: string | null };

const whenWords = (iso: string) => { const p = melbourneParts(new Date(iso)); const h = p.h % 12 || 12; return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday]} ${p.d}/${p.m} ${h}:${String(p.min).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`; };

/** R22: the guest declined. The visit is already cancelled and the slot reopened; the card says so until dismissed. */
export function buildDeclinedVisitItems(rows: DeclinedVisitRow[], now: Date): WorkItem[] {
  return rows.filter((r) => r.cancel_reason === "declined_invitation").map((r) => finish({
    key: itemKey("visit_declined", "visit", r.id, "declined"),
    kind: "visit_declined",
    accountId: r.account_id,
    subjectRef: { type: "visit", id: r.id },
    since: r.cancelled_at,
    title: `${r.customer_name || "A customer"} declined the visit — ${whenWords(r.starts_at)}`,
    detail: `The calendar invitation was declined, so the visit is cancelled and the time is free again${r.suburb ? ` (${r.suburb})` : ""}. Ring them if you want to rebook.`,
    dueAt: nextBusinessMorning(new Date(r.cancelled_at)).toISOString(),
    action: { label: "Open the estimate", href: r.estimate_id ? `/quote?id=${r.estimate_id}` : "/crm/diary" },
  }, { valueCents: null, promisedToCustomer: true }, now));
}

/** R27: moved in Google, unchanged here. Staff confirm with the customer, then move it on the Diary (or dismiss). */
export function buildMovedVisitItems(rows: MovedVisitRow[], now: Date): WorkItem[] {
  return rows.map((r) => finish({
    key: itemKey("visit_moved_in_google", "visit", r.visit_id, r.google_start),
    kind: "visit_moved_in_google",
    accountId: r.account_id,
    subjectRef: { type: "visit", id: r.visit_id },
    since: r.moved_seen_at,
    title: `${r.estimator_name || "The estimator"} moved ${r.customer_name || "a customer"}'s visit in Google — ${whenWords(r.visit_start)} → ${whenWords(r.google_start)}`,
    detail: "Nothing changed in the platform. Confirm the new time with the customer, then move the visit on the Diary so the invitation and the slot follow.",
    dueAt: addBusinessHours(new Date(r.moved_seen_at), 4).toISOString(),
    action: { label: "Open the Diary", href: "/crm/diary" },
  }, { valueCents: null, promisedToCustomer: true }, now));
}

/** 4.6: creating or updating events keeps failing for an estimator. */
export function buildGcalFailedItems(rows: GcalConnectionRow[], now: Date): WorkItem[] {
  return rows.filter((r) => r.sync_error).map((r) => finish({
    key: itemKey("gcal_sync_failed", "event", r.staff_id, "gcal"),
    kind: "gcal_sync_failed",
    accountId: null,
    subjectRef: { type: "event", id: r.staff_id },
    since: now.toISOString(),
    title: `Google Calendar sync is failing for ${r.estimator_name || r.google_email || "an estimator"}`,
    detail: `${r.sync_error}. Booked visits are safe in the platform; they are not reaching Google until this is fixed.`,
    dueAt: null,
    action: { label: "Open the Diary", href: "/crm/diary#gcal" },
  }, { valueCents: null, promisedToCustomer: false }, now));
}

/** 4.6: a zone whose estimator cannot be written to — customers there get the request path instead of the calendar. */
export function buildCalendarMissingItems(zones: ZoneEstimatorRow[], connections: GcalConnectionRow[], calendarRequired: boolean, now: Date): WorkItem[] {
  if (!calendarRequired) return [];
  const byStaff = new Map(connections.map((c) => [c.staff_id, c]));
  const seen = new Set<string>();
  const items: WorkItem[] = [];
  for (const z of zones) {
    if (!z.estimator_id || seen.has(z.estimator_id)) continue;
    const c = byStaff.get(z.estimator_id);
    const canWrite = !!c && typeof c.scopes === "string" && c.scopes.includes("calendar.events");
    if (canWrite) continue;
    seen.add(z.estimator_id);
    const zonesOf = zones.filter((x) => x.estimator_id === z.estimator_id).map((x) => x.key.replace("zone_", "Zone ")).join(", ");
    items.push(finish({
      key: itemKey("estimator_calendar_missing", "event", z.estimator_id, c ? "scope" : "none"),
      kind: "estimator_calendar_missing",
      accountId: null,
      subjectRef: { type: "event", id: z.estimator_id },
      since: now.toISOString(),
      title: `${z.estimator_name || "An estimator"}'s Google Calendar is ${c ? "connected without permission to write visits" : "not connected"}`,
      detail: `Customers in ${zonesOf} cannot book a time until it is; they are offered a request instead. ${c ? "Reconnect" : "Connect"} Google Calendar on the Diary.`,
      dueAt: null,
      action: { label: c ? "Reconnect" : "Connect", href: "/crm/diary#gcal" },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- assembly --------------------------------------------------------------

function finish(
  // `valueCents` is omitted with the derived fields: callers pass it in
  // `extra`, where `priorityOf` already needed it, so it is stated once.
  partial: Omit<WorkItem, "bucket" | "priority" | "valueCents">,
  extra: { valueCents: number | null; promisedToCustomer: boolean },
  now: Date,
): WorkItem {
  return {
    ...partial,
    bucket: bucketFor(partial.dueAt, now),
    valueCents: extra.valueCents,
    priority: priorityOf({
      kind: partial.kind,
      valueCents: extra.valueCents,
      overdueDays: overdueDays(partial.dueAt, now),
      promisedToCustomer: extra.promisedToCustomer,
    }),
  };
}

export type Dismissal = { item_key: string; until: string | null };

/** A dismissal suppresses that exact key until `until`, or for good. A re-fire
 *  under a new discriminator is a new key and comes straight back — §3.7. */
export function applyDismissals(items: WorkItem[], dismissals: Dismissal[], now: Date): WorkItem[] {
  const active = new Set(
    dismissals.filter((d) => d.until == null || new Date(d.until) > now).map((d) => d.item_key),
  );
  return items.filter((i) => !active.has(i.key));
}

const BUCKET_ORDER: Record<WorkItemBucket, number> = { overdue: 0, today: 1, waiting: 2 };

export function sortItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) =>
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
    || b.priority - a.priority
    || a.since.localeCompare(b.since),
  );
}

export type WorkQueue = {
  items: WorkItem[];
  counts: {
    total: number;
    byBucket: Record<WorkItemBucket, number>;
    byGroup: Record<Exclude<FilterGroup, "all">, number>;
    /** P7: sources whose read hit its cap this run — never a silent truncation. */
    truncated: string[];
  };
};

export function assembleQueue(raw: WorkItem[], dismissals: Dismissal[], now: Date, truncated: string[] = []): WorkQueue {
  const items = sortItems(applyDismissals(raw, dismissals, now));
  const byBucket: WorkQueue["counts"]["byBucket"] = { overdue: 0, today: 0, waiting: 0 };
  const byGroup: WorkQueue["counts"]["byGroup"] = { messages: 0, followups: 0, approvals: 0, money: 0 };
  for (const i of items) {
    byBucket[i.bucket] += 1;
    byGroup[GROUP_OF_KIND[i.kind]] += 1;
  }
  return { items, counts: { total: items.length, byBucket, byGroup, truncated } };
}

/** P7: "mine" = my customers and anyone nobody owns; "all" = the team's queue. */
export function scopeItems(items: WorkItem[], who: "mine" | "all", userId: string | null): WorkItem[] {
  if (who === "all" || !userId) return items;
  return items.filter((i) => !i.ownerId || i.ownerId === userId);
}

/** P7: items for one customer sit together — the lead card and the rest under it. */
export function groupByAccount(items: WorkItem[]): Array<{ lead: WorkItem; rest: WorkItem[] }> {
  const out: Array<{ lead: WorkItem; rest: WorkItem[] }> = [];
  const seen = new Map<string, number>();
  for (const i of items) {
    const key = i.accountId ?? `item:${i.key}`;
    const at = seen.get(key);
    if (at == null) { seen.set(key, out.length); out.push({ lead: i, rest: [] }); }
    else out[at].rest.push(i);
  }
  return out;
}

// ---- change requests (assistant S6) ------------------------------------------

export type ChangeRequestRow = {
  id: string; estimate_id: string; created_at: string;
  payload: { text?: string; areaId?: number | null } | null;
  estimates: { account_id: string | null; title: string | null } | null;
};
export type StaffReplyRow = { estimate_id: string; created_at: string };

/** A change asked for through the assistant on a sent estimate is open until
 *  staff reply in the estimate's thread after it. One item per request. */
export function buildChangeRequestItems(rows: ChangeRequestRow[], staffReplies: StaffReplyRow[], now: Date): WorkItem[] {
  const out: WorkItem[] = [];
  for (const r of rows) {
    const answered = staffReplies.some((m) => m.estimate_id === r.estimate_id && m.created_at > r.created_at);
    if (answered) continue;
    const text = (r.payload?.text ?? "").trim();
    const dueAt = new Date(new Date(r.created_at).getTime() + 24 * 3_600_000).toISOString();
    out.push({
      key: itemKey("change_request", "estimate", r.estimate_id, r.id.slice(0, 8)),
      kind: "change_request",
      accountId: r.estimates?.account_id ?? null,
      subjectRef: { type: "estimate", id: r.estimate_id },
      title: `Change requested on ${r.estimates?.title?.trim() || "an estimate"}`,
      detail: text ? `"${text.slice(0, 140)}"` : "Asked through the assistant.",
      since: r.created_at,
      dueAt,
      bucket: bucketFor(dueAt, now),
      valueCents: null,
      priority: priorityOf({ kind: "change_request", promisedToCustomer: true, overdueDays: overdueDays(dueAt, now), valueCents: null }),
      action: { label: "Reprice", href: `/quote?id=${r.estimate_id}&mode=revision` },
    });
  }
  return out;
}

// ---- live-chat handoffs (assistant S7) -------------------------------------------

export type HandoffQueueRow = {
  id: string; conversation_id: string; reason: string; status: string; requested_at: string; escalated_at: string | null; claimed_by: string | null;
  agent_conversations: { account_id: string | null; estimate_id: string | null; accounts?: { name: string | null; email: string } | null } | null;
};

/** One card per open handoff. Past the SLA it escalates — overdue,
 *  promised-to-customer priority. A claimed chat stays in the queue (the
 *  person is live) until it is resolved.
 *  Tom, 7 Sep (item 1): "X is waiting for a person — Claim / Log" read as a
 *  riddle. The card now says who asked, where they are, and what to do. */
export function buildHandoffItems(rows: HandoffQueueRow[], now: Date, slaSeconds = 180): WorkItem[] {
  return rows.filter((r) => ["requested", "claimed", "active"].includes(r.status)).map((r) => {
    const acct = r.agent_conversations?.accounts ?? null;
    const who = acct?.name?.trim() || acct?.email || "A customer";
    const dueAt = new Date(new Date(r.requested_at).getTime() + slaSeconds * 1000).toISOString();
    const live = r.status !== "requested";
    return {
      key: itemKey("handoff_requested", "thread", r.conversation_id, r.id.slice(0, 8)),
      kind: "handoff_requested",
      accountId: r.agent_conversations?.account_id ?? null,
      subjectRef: { type: "thread", id: r.conversation_id },
      title: live ? `Live chat with ${who}` : `${who} wants to talk to a person`,
      detail: live
        ? "You're in this chat — keep answering until it's sorted."
        : `They asked in the website chat (${r.reason.replace(/_/g, " ")}) and are waiting right now — open the chat and answer them.${r.escalated_at ? " Past the 3-minute promise." : ""}`,
      since: r.requested_at,
      dueAt: live ? null : dueAt,
      // A live-chat SLA is minutes, not days: past due IS overdue, today.
      bucket: live ? "today" : new Date(dueAt).getTime() <= now.getTime() ? "overdue" : "today",
      valueCents: null,
      priority: priorityOf({ kind: "handoff_requested", promisedToCustomer: true, overdueDays: r.escalated_at ? 1 : overdueDays(dueAt, now), valueCents: null }),
      action: { label: live ? "Open chat" : "Answer the chat", href: `/crm/chat/${r.conversation_id}` },
    };
  });
}

// ---- source: estimate_lapsed (CRM v2 P1, decision 8.11) --------------------

export type LapsedEventRow = {
  id: string; account_id: string; estimate_id: string | null; occurred_at: string;
  payload: { totalCents?: number; sentAt?: string | null; validUntil?: string | null } | null;
  /** The estimate as it is NOW: re-sent means the item is gone. */
  estimates: { status: string; title: string | null; viewed_at: string | null } | null;
};

/**
 * A quote lapsed and nobody has decided what that means. The item dies when
 * somebody contacts the customer after the lapse, when the estimate is no
 * longer expired (re-sent, accepted), or when it is dismissed with a reason.
 * Due two days after the lapse — it is not urgent, it is a decision.
 */
export function buildLapsedItems(rows: LapsedEventRow[], attempts: ContactEventRow[], accountNames: Map<string, string>, now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const ev of rows) {
    if (ev.estimates && ev.estimates.status !== "expired") continue;
    const touched = attempts.some((a) => a.account_id === ev.account_id && a.occurred_at > ev.occurred_at);
    if (touched) continue;
    const who = accountNames.get(ev.account_id) ?? "A customer";
    const cents = ev.payload?.totalCents ?? null;
    const sentAt = ev.payload?.sentAt ?? null;
    const sentDays = sentAt ? Math.floor((now.getTime() - new Date(sentAt).getTime()) / 86_400_000) : null;
    const detail = [
      cents != null && cents > 0 ? money(cents) : null,
      sentDays != null ? `sent ${sentDays}d ago` : null,
      ev.estimates?.viewed_at ? "was opened" : "never opened",
      "chase, re-send, or mark lost",
    ].filter(Boolean).join(" · ");
    items.push(finish({
      key: itemKey("estimate_lapsed", "estimate", ev.estimate_id ?? ev.id, "decide"),
      kind: "estimate_lapsed",
      accountId: ev.account_id,
      subjectRef: { type: "estimate", id: ev.estimate_id ?? ev.id },
      title: `${who}'s quote lapsed`,
      detail,
      since: ev.occurred_at,
      dueAt: new Date(new Date(ev.occurred_at).getTime() + 2 * 86_400_000).toISOString(),
      action: { label: "Decide", href: `/crm/customers/${ev.account_id}` },
    }, { valueCents: cents, promisedToCustomer: false }, now));
  }
  return items;
}

const isWarmOrHot = (t: string | null | undefined) => t === "hot" || t === "warm";

// ---- source: followup_due — a quote out with the customer, gone quiet (Tom, 15 Sep) ----

export type QuietQuoteRow = {
  id: string; title: string | null; account_id: string; status: string;
  sent_at: string | null; created_at: string; viewed_at: string | null; total_cents: number | null;
  /** estimates.source — an Airtable history quote ('airtable') is only chased for a hot or warm customer (Tom, 16 Sep 2026). */
  source?: string | null;
};

/** The event types that count as a person following up — one list, shared by
 *  the lapsed and quiet-quote sources so "we chased" means the same thing twice. */
export const CHASE_EVENT_TYPES = ["call_connected", "call_no_answer", "message_left", "estimate_sent", "sms_reply"] as const;

/**
 * Tom, 15 Sep: "ensure sent quote reminders go into the CRM to be followed
 * up — I can't see all of them in there." They weren't there: `followup_due`
 * was registered (weight, group, key shape, tests) and never given a source,
 * so the only sent quote Today ever showed was one that had already LAPSED.
 * The board's "Chase due" flag (lib/crm/stage.ts) knew the rule; the queue
 * did not.
 *
 * The rule is the board's, from Settings → CRM: a quote nobody has opened is
 * chased after `chaseUnopenedDays`; an opened one after `chaseOpenedDays`.
 * "Quiet" is measured from the LAST touch — the send, or the most recent
 * logged call / message after it — so chasing resets the clock and the item
 * comes back if the customer stays silent. Each cycle is a new fact and a
 * new key (`quiet-<anchor day>`), so a dismissal of one round never silences
 * the next (§3.7). At `goingColdDays` the key escalates to `cold-…`.
 *
 * One item per customer — the newest sent quote — because three revisions
 * to the same person are one follow-up, not three. Automated campaign
 * messages are deliberately NOT a touch: a reminder email going out is why
 * the item exists, not a reason for it to leave.
 */
export function buildQuietQuoteItems(
  rows: QuietQuoteRow[], attempts: ContactEventRow[], names: Map<string, string>,
  thresholds: Pick<CrmThresholds, "chaseUnopenedDays" | "chaseOpenedDays" | "goingColdDays">, now: Date,
  /** accounts.temperature by account — only read for imported history quotes. */
  temperature: Map<string, string | null> = new Map(),
  /** Tom, 7 Oct 2026: the account's latest acceptance. A quote sent before the
   *  customer said yes to one (an alternative, an earlier revision) is answered,
   *  not quiet — no follow-up. A quote sent AFTER the acceptance is a new job and
   *  is chased as before. */
  acceptedAt: Map<string, string> = new Map(),
): WorkItem[] {
  const items: WorkItem[] = [];
  const newestByAccount = new Map<string, QuietQuoteRow>();
  for (const r of rows) {
    if (r.status !== "sent" || !r.account_id) continue;
    if (answeredByAcceptance(acceptedAt, r.account_id, r.sent_at ?? r.created_at)) continue;
    // Tom, 16 Sep 2026: the 210 open quotes brought across from Airtable raise
    // a card only where the customer is hot or warm ("in negotiation" is hot
    // in the pack); a cold or unrated one waits until somebody touches it.
    if (r.source === "airtable" && !isWarmOrHot(temperature.get(r.account_id))) continue;
    const at = r.sent_at ?? r.created_at;
    const have = newestByAccount.get(r.account_id);
    if (!have || at > (have.sent_at ?? have.created_at)) newestByAccount.set(r.account_id, r);
  }
  for (const r of newestByAccount.values()) {
    const sentAt = r.sent_at ?? r.created_at;
    const lastTouch = attempts
      .filter((a) => a.account_id === r.account_id && a.occurred_at > sentAt)
      .reduce<string>((m, a) => (a.occurred_at > m ? a.occurred_at : m), sentAt);
    const quietDays = Math.floor((now.getTime() - new Date(lastTouch).getTime()) / 86_400_000);
    const opened = r.viewed_at != null;
    const threshold = opened ? thresholds.chaseOpenedDays : thresholds.chaseUnopenedDays;
    if (quietDays < threshold) continue;
    const cold = quietDays >= thresholds.goingColdDays;
    const sentDays = Math.floor((now.getTime() - new Date(sentAt).getTime()) / 86_400_000);
    const who = names.get(r.account_id) ?? "A customer";
    const cents = r.total_cents ?? null;
    const detail = [
      cents != null && cents > 0 ? money(cents) : null,
      `sent ${sentDays}d ago`,
      opened ? "opened" : "never opened",
      // The send's own crm_event lands a moment after sent_at; that is the send, not a chase.
      new Date(lastTouch).getTime() - new Date(sentAt).getTime() < 3_600_000 ? "no follow-up since" : `last contact ${quietDays}d ago`,
      cold ? "going cold" : null,
    ].filter(Boolean).join(" · ");
    items.push(finish({
      key: itemKey("followup_due", "estimate", r.id, `${cold ? "cold" : "quiet"}-${melbourneDay(new Date(lastTouch)).replace(/-/g, "")}`),
      kind: "followup_due",
      accountId: r.account_id,
      subjectRef: { type: "estimate", id: r.id },
      title: cold ? `${who}'s quote is going cold` : `${who} — quote sent, no reply`,
      detail,
      since: lastTouch,
      dueAt: new Date(new Date(lastTouch).getTime() + threshold * 86_400_000).toISOString(),
      action: { label: "Follow up", href: `/crm/customers/${r.account_id}` },
    }, { valueCents: cents, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- source: hours_to_confirm — a handover job with no per-area hours (16 Sep) ----

export type HoursPendingRow = { id: string; title: string | null; account_id: string | null; accepted_at: string | null; created_at: string; total_cents: number | null; external_ref: { quote_no?: unknown; hours_pending?: unknown } | null };

/** One item per signed job whose feed carried no per-area hours (brief C1). The
 *  key is the estimate, so the item leaves the moment the hours are typed and
 *  `hours_pending` is cleared. */
export function buildHoursPendingItems(rows: HoursPendingRow[], now: Date): WorkItem[] {
  return rows.filter((r) => r.external_ref?.hours_pending === true).map((r) => {
    const since = r.accepted_at ?? r.created_at;
    const quote = typeof r.external_ref?.quote_no === "string" ? r.external_ref.quote_no : "";
    return finish({
      key: itemKey("hours_to_confirm", "estimate", r.id, "pending"),
      kind: "hours_to_confirm",
      accountId: r.account_id,
      subjectRef: { type: "estimate", id: r.id },
      title: `${r.title || "A signed job"} — hours to confirm`,
      detail: [quote ? `PaintScout quote ${quote}` : null, r.total_cents ? money(r.total_cents) : null, "arrived from Airtable with no per-area hours"].filter(Boolean).join(" · "),
      since,
      dueAt: since,
      action: { label: "Type the hours", href: `/quote?id=${r.id}` },
    }, { valueCents: r.total_cents ?? null, promisedToCustomer: false }, now);
  });
}

// ---- source: messages (CRM v2 P3) ------------------------------------------

export type InboundMessageRow = {
  id: string; account_id: string | null; channel: string; subject: string | null; body: string;
  from_address: string | null; occurred_at: string; read_at: string | null;
};
/** Dashboard 0b: an automation's chase is outbound but not a reply — the customer is still waiting. */
export type OutboundTouchRow = { account_id: string; occurred_at: string; sender_role: string | null };

const MESSAGE_OVERDUE_HOURS = 4;   // ⚑7.8 — a customer message waits four hours, an unmatched one a day
const excerpt = (m: InboundMessageRow) => (m.subject?.trim() || m.body.replace(/\s+/g, " ").trim()).slice(0, 120) || "(no text)";

/**
 * A customer wrote to us and nobody has written back. Answered = an outbound
 * message to that account after it (any channel), or a logged call after it.
 * An inbound message with no customer is a different item: attach it.
 */
export function buildMessageItems(
  inbound: InboundMessageRow[], outbound: OutboundTouchRow[], attempts: ContactEventRow[], names: Map<string, string>, now: Date,
  overdueHours: number = MESSAGE_OVERDUE_HOURS,
): WorkItem[] {
  const items: WorkItem[] = [];
  for (const m of inbound) {
    if (!m.account_id) {
      items.push(finish({
        key: itemKey("message_unmatched", "thread", m.id, "attach"),
        kind: "message_unmatched",
        accountId: null,
        subjectRef: { type: "thread", id: m.id },
        title: `A ${m.channel === "sms" ? "text" : m.channel} from ${m.from_address ?? "an unknown sender"}`,
        detail: `${excerpt(m)} · not matched to a customer yet`,
        since: m.occurred_at,
        dueAt: new Date(new Date(m.occurred_at).getTime() + 24 * 3_600_000).toISOString(),
        action: { label: "Attach", href: `/crm/messages/${m.id}` },
      }, { valueCents: null, promisedToCustomer: false }, now));
      continue;
    }
    const answered = outbound.some((o) => o.account_id === m.account_id && o.occurred_at > m.occurred_at && o.sender_role !== "system" && o.sender_role !== "assistant")
      || attempts.some((a) => a.account_id === m.account_id && a.occurred_at > m.occurred_at);
    if (answered) continue;
    const who = names.get(m.account_id) ?? "A customer";
    items.push(finish({
      key: itemKey("message_unanswered", "thread", m.id, "reply"),
      kind: "message_unanswered",
      accountId: m.account_id,
      subjectRef: { type: "thread", id: m.id },
      title: `${who} sent a ${m.channel === "sms" ? "text" : m.channel === "portal" ? "message" : m.channel}`,
      detail: excerpt(m),
      since: m.occurred_at,
      dueAt: new Date(new Date(m.occurred_at).getTime() + overdueHours * 3_600_000).toISOString(),
      action: { label: "Reply", href: `/crm/customers/${m.account_id}#messages` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

// ---- source: delay_ended (CRM v2 P4) ---------------------------------------

export type DelayedAccountRow = { id: string; name: string | null; email: string | null; phone: string | null; state_until: string | null; state_note: string | null; state_reason: string | null };

/** "Not until March" — and it is March. The item lives until someone sets a
 *  new state (or a new date); the note is the whole point of it. */
export function buildDelayEndedItems(rows: DelayedAccountRow[], now: Date): WorkItem[] {
  return rows.filter((r) => r.state_until && new Date(r.state_until) <= now).map((r) => finish({
    key: itemKey("delay_ended", "account", r.id, r.state_until!.slice(0, 10)),
    kind: "delay_ended",
    accountId: r.id,
    subjectRef: { type: "account", id: r.id },
    title: `${r.name || r.email || r.phone || "A customer"} — the delay is up`,
    detail: r.state_note || r.state_reason || "No note was left when it was delayed — open the record and decide.",
    since: r.state_until!,
    dueAt: r.state_until!,
    action: { label: "Open", href: `/crm/customers/${r.id}` },
  }, { valueCents: null, promisedToCustomer: Boolean(r.state_note) }, now));
}

/** Nothing about a do-not-contact, archived, or still-delayed customer belongs
 *  in Today (deep dive §4.5). Their items are dropped here, in one place. */
export function suppressQuiet(items: WorkItem[], quietAccountIds: Set<string>): WorkItem[] {
  return items.filter((i) => !i.accountId || !quietAccountIds.has(i.accountId) || i.kind === "delay_ended");
}

// ---- the loader ------------------------------------------------------------


/**
 * P7: an `in` list of uuids is a URL, and ~400 of them is a 15 KB URL the
 * request layer refuses (found on the P5 rebuild). Every id-keyed read here
 * goes in slices; a source that hands over 500 invoices still reads its
 * payments.
 */
/**
 * The slicing itself now lives in lib/supabase/inSlices.ts, so Invoicing gets
 * the same protection — 16 Sep 2026: its payments read had exactly the long-URL
 * bug this helper was written for, and no slicing. This wrapper keeps the
 * queue's own signature, rows only.
 *
 * ⚚ It still DROPS a refused slice's error, which is the queue's existing
 * behaviour and not something to change blind: a work item that quietly loses
 * its payments understates what needs chasing. Worth revisiting with the
 * unchecked-read audit (CLAUDE.md), not inside an invoicing fix.
 */
async function inSlices<T>(ids: string[], run: (slice: string[]) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>): Promise<T[]> {
  const { rows } = await sliceRead<T>(ids, run);
  return rows;
}

/**
 * Every read is bounded and indexed; no source may scan a table. The caps are
 * generous against today's volumes (5 accounts, 25 estimates) and the 2A.10
 * performance gate re-tests them at 25,000 accounts.
 *
 * Sources not yet feeding the registry (§5, 2A.9): visit_rebook waits on visit booking;
 * variation_pending, signoff_due, broadcast_incomplete and consent_missing
 * arrive with their modules. Each is one function plus a call here — never a
 * change to the queue itself.
 */
/** The joined shapes PostgREST returns for the S5 reads, flattened. A moved event only counts while the visit is still booked. */
function movedRows(rows: unknown[], visits: Array<{ id: string; starts_at: string; status: string; account_id: string | null; estimate_id: string | null; customer_name: string | null }>): MovedVisitRow[] {
  const byId = new Map(visits.map((v) => [v.id, v]));
  const out: MovedVisitRow[] = [];
  for (const raw of rows as Array<{ id: string; ref_id: string; staff_id: string; google_start: string | null; moved_seen_at: string | null; profiles?: { name?: string | null } | null }>) {
    const v = byId.get(raw.ref_id);
    if (!raw.google_start || !raw.moved_seen_at || !v || v.status !== "booked") continue;
    if (Math.abs(new Date(raw.google_start).getTime() - new Date(v.starts_at).getTime()) < 60_000) continue;
    out.push({ id: raw.id, visit_id: raw.ref_id, staff_id: raw.staff_id, google_start: raw.google_start, moved_seen_at: raw.moved_seen_at, visit_start: v.starts_at, account_id: v.account_id, estimate_id: v.estimate_id, customer_name: v.customer_name, estimator_name: raw.profiles?.name ?? null });
  }
  return out;
}
function connRows(rows: unknown[]): GcalConnectionRow[] {
  return (rows as Array<{ staff_id: string; google_email: string | null; sync_error: string | null; scopes: string | null; profiles?: { name?: string | null } | null }>)
    .map((r) => ({ staff_id: r.staff_id, google_email: r.google_email, sync_error: r.sync_error, scopes: r.scopes, estimator_name: r.profiles?.name ?? null }));
}

/** Booked jobs whose last day is within the last fortnight — the rows the check-in planner reads. */
async function readJobCheckinRows(supabase: SupabaseClient, now: Date): Promise<{ rows: JobCheckinRow[]; error: string | null }> {
  const res = await supabase.from("work_orders")
    .select("id, wo_ref, stage, start_date, end_date, wo_snapshot, estimates(account_id, accepted_name, title), contractors(company_name, works_saturday, works_sunday, profiles(name))")
    .not("start_date", "is", null).not("end_date", "is", null).neq("stage", "offered")
    .gte("end_date", new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10))
    .lte("start_date", now.toISOString().slice(0, 10))
    .order("start_date", { ascending: true }).limit(300);
  if (res.error) return { rows: [], error: res.error.message };
  return { rows: (res.data ?? []) as unknown as JobCheckinRow[], error: null };
}

/**
 * The PC-homed slice of the one queue, for PC Command (Tom, 6 Oct 2026): the
 * customer check-ins and after-job calls, with the same dismissals Today
 * honours. Two bounded reads, no evaluator fan-out — the console does not
 * need the messages, invoices or wizard sessions to list its calls.
 *
 * A failed read is a line the screen can show, never an empty list.
 */
/**
 * Standards Step 2 (⚑17, ⚑2): a painter invited pcCardDay days ago (Settings →
 * standards_rules) who has still not confirmed the six sections. One card per
 * painter per required version; it clears itself the moment they confirm.
 * Contractors past their grace have no job offers; an employee is a reminder
 * only — the card says which.
 */
export type StandardsUnsignedRow = {
  contractorId: string; name: string; status: StandardsStatus; invitedAt: string | null;
  graceUntil: string | null; ackedSections: number; requiredVersion: number | null; remindersSent: number;
};

export function buildStandardsItems(rows: readonly StandardsUnsignedRow[], rules: StandardsRules, now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  for (const r of rows) {
    if (!needsSignoff(r.status) || !r.invitedAt) continue;
    const due = standardsCardDueAt(new Date(r.invitedAt), rules);
    if (now.getTime() < due.getTime()) continue;
    const days = Math.floor((now.getTime() - new Date(r.invitedAt).getTime()) / 86_400_000);
    const consequence = r.status === "blocked" ? "No job offers until they confirm."
      : r.status === "grace" ? `Job offers stop ${new Date(r.graceUntil as string).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}.`
      : "Employed painter — a reminder, nothing is blocked.";
    items.push(finish({
      key: itemKey("standards_unsigned", "contractor", r.contractorId, `v${r.requiredVersion ?? 0}`),
      kind: "standards_unsigned",
      accountId: null,
      subjectRef: { type: "contractor", id: r.contractorId },
      title: `${r.name} has not signed the finish standards`,
      detail: `Invited ${days} day${days === 1 ? "" : "s"} ago · ${r.ackedSections} of 6 sections ticked · ${r.remindersSent} reminder text${r.remindersSent === 1 ? "" : "s"} sent. ${consequence}`,
      since: r.invitedAt,
      dueAt: due.toISOString(),
      action: { label: "Send reminder text", href: `/contractors/${r.contractorId}` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

async function readStandardsRows(supabase: SupabaseClient): Promise<{ rows: StandardsUnsignedRow[]; rules: StandardsRules; error: string | null }> {
  const [{ rows: statuses, error }, rules, names, reminders, version] = await Promise.all([
    loadStandardsStatuses(supabase),
    loadStandardsRules(supabase),
    supabase.from("contractors").select("id, company_name, profiles(name)"),
    supabase.from("contractor_events").select("contractor_id").eq("type", "standards_reminder_sent").limit(2000),
    supabase.from("standards_versions").select("version_no").not("published_at", "is", null).eq("is_material", true).order("version_no", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return { rows: [], rules, error };
  if (names.error) return { rows: [], rules, error: names.error.message };
  const nameOf = new Map(((names.data ?? []) as unknown as { id: string; company_name: string | null; profiles: { name: string | null } | null }[])
    .map((c) => [c.id, c.profiles?.name || c.company_name || "Painter"]));
  const sent = new Map<string, number>();
  for (const e of (reminders.error ? [] : reminders.data ?? []) as { contractor_id: string }[]) sent.set(e.contractor_id, (sent.get(e.contractor_id) ?? 0) + 1);
  const requiredVersion = (version.data as { version_no?: number } | null)?.version_no ?? null;
  return {
    rows: statuses.map((s) => ({
      contractorId: s.contractorId, name: nameOf.get(s.contractorId) ?? "Painter", status: s.status, invitedAt: s.invitedAt,
      graceUntil: s.graceUntil, ackedSections: s.ackedSections, requiredVersion, remindersSent: sent.get(s.contractorId) ?? 0,
    })),
    rules, error: null,
  };
}

/**
 * Call backs (brief §8), each trigger exactly one card that clears itself:
 *   · walkthrough_flagged — the customer flagged an area and nobody has put
 *     it right, withdrawn the flag or logged a call back: "Is a call back
 *     required?" Critical once the flag's day has passed unsigned.
 *   · callback_unbooked — open with no return visit: book it.
 *   · callback_visit_soon — the visit is today or tomorrow: view the job.
 *   · callback_fixed — the painter marked it fixed: confirm and close.
 */
export type CallbackQueueRow = {
  id: string; workOrderId: string; status: string; source: string; description: string; createdAt: string; fixedAt: string | null;
  visit: { start: string; end: string } | null; woRef: string; where: string; painter: string | null;
};
export type FlaggedWalkthroughRow = { workOrderId: string; woRef: string; where: string; painter: string | null; areas: string[]; flaggedAt: string };

export function buildWoCallbackItems(callbacks: readonly CallbackQueueRow[], flagged: readonly FlaggedWalkthroughRow[], now: Date): WorkItem[] {
  const items: WorkItem[] = [];
  const today = MELB_DAY_KEY.format(now);
  const tomorrow = MELB_DAY_KEY.format(new Date(now.getTime() + 86_400_000));
  for (const f of flagged) {
    const flaggedDay = MELB_DAY_KEY.format(new Date(f.flaggedAt));
    items.push(finish({
      key: itemKey("walkthrough_flagged", "work_order", f.workOrderId, flaggedDay),
      kind: "walkthrough_flagged", accountId: null, subjectRef: { type: "work_order", id: f.workOrderId },
      title: `Walk-through flagged ${f.areas.length === 1 ? "an area" : `${f.areas.length} areas`} at ${f.where}`,
      detail: `${f.woRef}${f.painter ? ` · ${f.painter}` : ""} · ${f.areas.join(", ")}. Is a call back required? Fixed and signed today is a pass after a fix.${flaggedDay < today ? " Not signed by the end of that day." : ""}`,
      since: f.flaggedAt,
      // Due at the end of the flag's day: past it, the card is overdue (critical).
      dueAt: melbInstant(flaggedDay, 18).toISOString(),
      action: { label: "Is a call back required?", href: `/pc/wo/${f.workOrderId}?callback=walkthrough_fail#callbacks` },
    }, { valueCents: null, promisedToCustomer: true }, now));
  }
  for (const c of callbacks) {
    const who = `${c.woRef}${c.painter ? ` · ${c.painter}` : ""}`;
    if (c.status === "fixed") {
      items.push(finish({
        key: itemKey("callback_fixed", "work_order", c.workOrderId, c.id),
        kind: "callback_fixed", accountId: null, subjectRef: { type: "work_order", id: c.workOrderId },
        title: `${c.painter ?? "The painter"} marked the call back at ${c.where} fixed`,
        detail: `${who} · ${c.description || "no description"}. Confirm it and close the call back — invoice chasing resumes when you do.`,
        since: c.fixedAt ?? c.createdAt, dueAt: nextBusinessMorning(new Date(c.fixedAt ?? c.createdAt)).toISOString(),
        action: { label: "Confirm and close", href: `/pc/wo/${c.workOrderId}#callbacks` },
      }, { valueCents: null, promisedToCustomer: true }, now));
      continue;
    }
    if (!c.visit) {
      items.push(finish({
        key: itemKey("callback_unbooked", "work_order", c.workOrderId, c.id),
        kind: "callback_unbooked", accountId: null, subjectRef: { type: "work_order", id: c.workOrderId },
        title: `Call back at ${c.where} has no return visit booked`,
        detail: `${who} · ${c.description || "no description"}. Book the visit in the painter's scheduler.`,
        since: c.createdAt, dueAt: nextBusinessMorning(new Date(c.createdAt)).toISOString(),
        action: { label: "Book the visit", href: `/pc/wo/${c.workOrderId}#callbacks` },
      }, { valueCents: null, promisedToCustomer: true }, now));
      continue;
    }
    if (c.visit.start === today || c.visit.start === tomorrow) {
      items.push(finish({
        key: itemKey("callback_visit_soon", "work_order", c.workOrderId, `${c.id}:${c.visit.start}`),
        kind: "callback_visit_soon", accountId: null, subjectRef: { type: "work_order", id: c.workOrderId },
        title: `Call back visit ${c.visit.start === today ? "today" : "tomorrow"}: ${c.where}`,
        detail: `${who} · ${c.description || "no description"}.`,
        since: c.createdAt, dueAt: null,
        action: { label: "View job", href: `/pc/wo/${c.workOrderId}#callbacks` },
      }, { valueCents: null, promisedToCustomer: false }, now));
    }
  }
  return items;
}

async function readCallbackRows(supabase: SupabaseClient): Promise<{ callbacks: CallbackQueueRow[]; flagged: FlaggedWalkthroughRow[]; error: string | null }> {
  const [cbRes, flagRes] = await Promise.all([
    supabase.from("wo_callbacks")
      .select("id, work_order_id, status, source, description, created_at, fixed_at, wo_appointments(start_date, end_date), work_orders(wo_ref, wo_snapshot, contractors(company_name, profiles(name)))")
      .in("status", ["open", "booked", "fixed"]).order("created_at").limit(300),
    supabase.from("wo_signoff")
      .select("work_order_id, areas, work_orders(wo_ref, stage, wo_snapshot, contractors(company_name, profiles(name)))")
      .is("signed_at", null).not("evidence_pack_sent_at", "is", null).limit(300),
  ]);
  if (cbRes.error) return { callbacks: [], flagged: [], error: cbRes.error.code === "42P01" ? "call backs are not switched on yet (migration 20270226)" : cbRes.error.message };
  if (flagRes.error) return { callbacks: [], flagged: [], error: flagRes.error.message };
  type WoBit = { wo_ref: string; stage?: string; wo_snapshot: { jobAddress?: string; jobTitle?: string } | null; contractors: { company_name: string | null; profiles: { name: string | null } | null } | null } | null;
  const nameOf = (w: WoBit) => w?.contractors?.profiles?.name || w?.contractors?.company_name || null;
  const whereOf = (w: WoBit) => w?.wo_snapshot?.jobAddress || w?.wo_snapshot?.jobTitle || w?.wo_ref || "the job";
  const callbacks = ((cbRes.data ?? []) as unknown as { id: string; work_order_id: string; status: string; source: string; description: string; created_at: string; fixed_at: string | null; wo_appointments: { start_date: string; end_date: string } | null; work_orders: WoBit }[])
    .map((r) => ({ id: r.id, workOrderId: r.work_order_id, status: r.status, source: r.source, description: r.description, createdAt: r.created_at, fixedAt: r.fixed_at,
      visit: r.wo_appointments ? { start: r.wo_appointments.start_date, end: r.wo_appointments.end_date } : null,
      woRef: r.work_orders?.wo_ref ?? "", where: whereOf(r.work_orders), painter: nameOf(r.work_orders) }));
  const openWalkthroughCallback = new Set(callbacks.filter((c) => c.source === "walkthrough_fail").map((c) => c.workOrderId));
  const flagged: FlaggedWalkthroughRow[] = [];
  for (const r of (flagRes.data ?? []) as unknown as { work_order_id: string; areas: Record<string, { flagged_at?: string; rectified_at?: string; flag_withdrawn_at?: string }> | null; work_orders: WoBit }[]) {
    if (openWalkthroughCallback.has(r.work_order_id)) continue;
    if (r.work_orders?.stage === "closed") continue;
    const open = Object.entries(r.areas ?? {}).filter(([, a]) => a?.flagged_at && !a?.rectified_at && !a?.flag_withdrawn_at);
    if (open.length === 0) continue;
    flagged.push({ workOrderId: r.work_order_id, woRef: r.work_orders?.wo_ref ?? "", where: whereOf(r.work_orders), painter: nameOf(r.work_orders),
      areas: open.map(([h]) => h), flaggedAt: open.map(([, a]) => a.flagged_at as string).sort()[0] });
  }
  return { callbacks, flagged, error: null };
}

// ---- source: painter status, bonus reviews, payment holds (Step 7, brief §8) --

export type PainterStatusQueueRow = { painter_id: string; colour: string; offers_cleared_at: string | null; computed_at: string; name: string };
/** The latest status_changed event per painter — the episode a card belongs to, so "Rang them" outlives the half-hourly recompute. */
export type StatusChangeRow = { id: string; contractor_id: string; created_at: string; to: string | null };
export type BonusQueueRow = { id: string; painter_id: string; status: string; triggered_at: string; handed_over_at: string | null; qualifying_changed_at: string | null; qualifying_wo_ids: unknown; name: string };
export type HeldInvoiceRow = { id: string; contractor_id: string; terms_held_at: string | null; terms_hold_reason: string; due_on: string | null; status: string; wo_ref: string | null; name: string };

/**
 * One card per trigger, cleared by the fact itself: Orange clears when the
 * colour moves on (or the PC dismisses "Rang them" for this episode); Red
 * clears when the owner records the clearance or the colour changes; a bonus
 * card clears when it is handed over, decided, or its change is reviewed; a
 * hold card clears when the hold is released or the invoice paid.
 */
export function buildPainterStatusItems(
  statuses: readonly PainterStatusQueueRow[], changes: readonly StatusChangeRow[],
  bonuses: readonly BonusQueueRow[], held: readonly HeldInvoiceRow[], now: Date,
): WorkItem[] {
  const items: WorkItem[] = [];
  const episode = new Map<string, StatusChangeRow>();
  for (const c of changes) if (!episode.has(c.contractor_id)) episode.set(c.contractor_id, c);
  for (const s of statuses) {
    if (s.colour !== "orange" && s.colour !== "red") continue;
    if (s.colour === "red" && s.offers_cleared_at) continue;
    const ep = episode.get(s.painter_id);
    const since = ep?.created_at ?? s.computed_at;
    const kind: WorkItemKind = s.colour === "red" ? "painter_red" : "painter_orange";
    items.push(finish({
      key: itemKey(kind, "contractor", s.painter_id, ep?.id ?? s.colour),
      kind, accountId: null, subjectRef: { type: "contractor", id: s.painter_id },
      title: s.colour === "red" ? `${s.name} dropped to Red` : `${s.name} dropped to Orange`,
      detail: s.colour === "red"
        ? "No new job offers until Tom has spoken with them and recorded the clearance. Jobs under way finish as normal."
        : "Ring them this week and go through the score. Every job now gets a quality check; offers come after Green and Yellow.",
      since, dueAt: new Date(new Date(since).getTime() + (s.colour === "red" ? 1 : 3) * 86_400_000).toISOString(),
      action: { label: "Open their score", href: `/contractors/${s.painter_id}` },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  for (const b of bonuses) {
    if (b.status === "due") {
      items.push(finish({
        key: itemKey("bonus_due", "contractor", b.painter_id, b.id),
        kind: "bonus_due", accountId: null, subjectRef: { type: "contractor", id: b.painter_id },
        title: `Bonus due: ${b.name}`,
        detail: `${Array.isArray(b.qualifying_wo_ids) ? b.qualifying_wo_ids.length : 4} clean jobs of 16 hours or more while on Green. Tom sets the amount.`,
        since: b.triggered_at, dueAt: new Date(new Date(b.triggered_at).getTime() + 7 * 86_400_000).toISOString(),
        action: { label: "Tell Tom", href: `/contractors/${b.painter_id}` },
      }, { valueCents: null, promisedToCustomer: false }, now));
    }
    if (b.qualifying_changed_at && (b.status === "due" || b.status === "with_owner")) {
      items.push(finish({
        key: itemKey("bonus_changed", "contractor", b.painter_id, `${b.id}:${b.qualifying_changed_at}`),
        kind: "bonus_changed", accountId: null, subjectRef: { type: "contractor", id: b.painter_id },
        title: `A qualifying job changed: ${b.name}`,
        detail: "One of the clean jobs behind this bonus review is no longer clean (a late call back or a changed reason). The review stands — look before deciding.",
        since: b.qualifying_changed_at, dueAt: new Date(new Date(b.qualifying_changed_at).getTime() + 3 * 86_400_000).toISOString(),
        action: { label: "Review", href: `/contractors/${b.painter_id}` },
      }, { valueCents: null, promisedToCustomer: false }, now));
    }
  }
  for (const h of held) {
    if (h.status === "paid") continue;
    const since = h.terms_held_at ?? now.toISOString();
    items.push(finish({
      key: itemKey("payment_hold", "invoice", h.id, since),
      kind: "payment_hold", accountId: null, subjectRef: { type: "invoice", id: h.id },
      title: `Payment hold: ${h.name}${h.wo_ref ? ` · ${h.wo_ref}` : ""}`,
      detail: `${h.terms_hold_reason || "No reason recorded"}. Their Green fast payment is back on the default terms${h.due_on ? ` (due ${h.due_on})` : ""} — release it or keep it.`,
      since, dueAt: new Date(new Date(since).getTime() + 2 * 86_400_000).toISOString(),
      action: { label: "Release or keep", href: "/invoicing?tab=payables" },
    }, { valueCents: null, promisedToCustomer: false }, now));
  }
  return items;
}

async function readPainterStatusRows(supabase: SupabaseClient): Promise<{ statuses: PainterStatusQueueRow[]; changes: StatusChangeRow[]; bonuses: BonusQueueRow[]; held: HeldInvoiceRow[]; error: string | null }> {
  type CJoin = { company_name: string | null; profiles: { name: string | null } | null } | null;
  const nameOf = (c: CJoin) => c?.profiles?.name?.trim() || c?.company_name?.trim() || "A painter";
  const [st, ch, bo, he] = await Promise.all([
    supabase.from("painter_status").select("painter_id, colour, offers_cleared_at, computed_at, contractors(company_name, profiles(name))").in("colour", ["orange", "red"]),
    supabase.from("contractor_events").select("id, contractor_id, created_at, detail").eq("type", "status_changed").order("created_at", { ascending: false }).limit(300),
    supabase.from("painter_bonuses").select("id, painter_id, status, triggered_at, handed_over_at, qualifying_changed_at, qualifying_wo_ids, contractors(company_name, profiles(name))").in("status", ["due", "with_owner"]),
    supabase.from("contractor_invoices").select("id, contractor_id, terms_held_at, terms_hold_reason, due_on, status, work_orders(wo_ref), contractors(company_name, profiles(name))").eq("terms_kind", "held").neq("status", "paid"),
  ]);
  // The bonus table is owner / admin / PC only; a session outside those roles gets rows it may not read refused — that is not a failure of the queue.
  const errors = [st.error, ch.error, he.error].filter(Boolean).map((e) => e!.message);
  return {
    statuses: ((st.data ?? []) as unknown as { painter_id: string; colour: string; offers_cleared_at: string | null; computed_at: string; contractors: CJoin }[]).map((r) => ({ painter_id: r.painter_id, colour: r.colour, offers_cleared_at: r.offers_cleared_at, computed_at: r.computed_at, name: nameOf(r.contractors) })),
    changes: ((ch.data ?? []) as { id: string; contractor_id: string; created_at: string; detail: { to?: string } | null }[]).map((r) => ({ id: r.id, contractor_id: r.contractor_id, created_at: r.created_at, to: r.detail?.to ?? null })),
    bonuses: bo.error ? [] : ((bo.data ?? []) as unknown as { id: string; painter_id: string; status: string; triggered_at: string; handed_over_at: string | null; qualifying_changed_at: string | null; qualifying_wo_ids: unknown; contractors: CJoin }[]).map((r) => ({ ...r, name: nameOf(r.contractors) })),
    held: ((he.data ?? []) as unknown as { id: string; contractor_id: string; terms_held_at: string | null; terms_hold_reason: string; due_on: string | null; status: string; work_orders: { wo_ref: string | null } | null; contractors: CJoin }[]).map((r) => ({ id: r.id, contractor_id: r.contractor_id, terms_held_at: r.terms_held_at, terms_hold_reason: r.terms_hold_reason, due_on: r.due_on, status: r.status, wo_ref: r.work_orders?.wo_ref ?? null, name: nameOf(r.contractors) })),
    error: errors.length ? errors.join("; ") : null,
  };
}

export async function buildPcWorkItems(supabase: SupabaseClient, now = new Date()): Promise<{ items: WorkItem[]; failure: string | null }> {
  const [checkins, standards, callbacks, painters, dismissed] = await Promise.all([
    readJobCheckinRows(supabase, now),
    readStandardsRows(supabase),
    readCallbackRows(supabase),
    readPainterStatusRows(supabase),
    supabase.from("work_item_dismissals").select("item_key, until").or(`until.is.null,until.gt.${now.toISOString()}`).limit(500),
  ]);
  if (checkins.error) return { items: [], failure: `Couldn't read the jobs for check-ins: ${checkins.error}` };
  const dismissals = (dismissed.error ? [] : (dismissed.data ?? [])) as Dismissal[];
  const built = [
    ...buildJobCheckinItems(checkins.rows, now),
    ...buildStandardsItems(standards.rows, standards.rules, now),
    ...buildWoCallbackItems(callbacks.callbacks, callbacks.flagged, now),
    ...buildPainterStatusItems(painters.statuses, painters.changes, painters.bonuses, painters.held, now),
  ];
  const items = sortItems(applyDismissals(pcItems(built), dismissals, now));
  const failures = [
    dismissed.error ? `Dismissals couldn't be read (${dismissed.error.message}) — a call you already made may show again.` : null,
    standards.error ? `Couldn't read who has signed the standards (${standards.error}).` : null,
    callbacks.error ? `Couldn't read the call backs (${callbacks.error}).` : null,
    painters.error ? `Couldn't read painter status (${painters.error}).` : null,
  ].filter(Boolean);
  return { items, failure: failures.length ? failures.join(" ") : null };
}

export async function buildWorkQueue(supabase: SupabaseClient, now = new Date()): Promise<WorkQueue> {
  const nowIso = now.toISOString();
  const since90d = new Date(now.getTime() - 90 * 86_400_000).toISOString();

  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  // P7: every capped read is ORDERED by its urgency key (oldest first), and a
  // read that fills its cap is reported on the queue rather than dropped silently.
  const CAP = { followups: 500, invoices: 500, callbacks: 200, wizard: 300, lapsed: 300, inbound: 400, rebook: 200, quotes: 500 };
  const truncated: string[] = [];
  const [snoozeAcc, invoices, callbacks, queued, pendingHolds, dismissed, changeReqs, handoffs, wizardRows, lapsedEvents, inboundMsgs, delayedAcc, thresholds, unmappedSuburbs, visitRequests, bookingRules, declinedVisits, movedEvents, gcalConns, zoneEstimators] = await Promise.all([
    supabase.from("accounts")
      .select("id, name, email, snoozed_until, followup_due_at, followup_note")
      .or(`snoozed_until.lte.${nowIso},followup_due_at.lte.${nowIso}`)
      .order("followup_due_at", { ascending: true, nullsFirst: false })
      .limit(CAP.followups),
    supabase.from("invoices")
      .select("id, estimate_id, kind, status, total_inc_cents, due_on, issued_on, estimates(account_id, accepted_name, title, job_address:sent_snapshot->>jobAddress)")
      .in("status", [...OPEN_STATUSES])
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(CAP.invoices),
    supabase.from("crm_events")
      .select("id, account_id, occurred_at, payload")
      .eq("type", "callback_requested")
      .gte("occurred_at", since90d)
      .order("occurred_at", { ascending: true })
      .limit(CAP.callbacks),
    supabase.from("campaign_messages")
      .select("id", { count: "exact", head: true })
      .eq("state", "queued"),
    supabase.from("automation_holds")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("work_item_dismissals")
      .select("item_key, until")
      .or(`until.is.null,until.gt.${nowIso}`)
      .limit(500),
    supabase.from("estimate_events")
      .select("id, estimate_id, created_at, payload, estimates(account_id, title)")
      .eq("type", "change_request")
      .gte("created_at", since90d)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("agent_handoffs")
      .select("id, conversation_id, reason, status, requested_at, escalated_at, claimed_by, agent_conversations(account_id, estimate_id, accounts(name, email))")
      .in("status", ["requested", "claimed", "active"])
      .order("requested_at", { ascending: true })
      .limit(100),
    // Buckets brief §4: sessions in A, B or C+ from the last 30 days. Until
    // migration 20270107 runs the columns don't exist and the read errors;
    // the queue stands up without them.
    supabase.from("wizard_drafts")
      .select("id, account_id, estimate_id, name, email, phone, address, suburb, job_type, bucket, outcome, outcome_at, outcome_note, dropped_at, furthest_page, pages_total, active_seconds, last_seen_at, est_value_cents, entry_source")
      .in("bucket", ["ready_call", "ready_visit", "needs_help", "priced_no_request"])
      .gte("last_seen_at", since30d)
      .order("last_seen_at", { ascending: false })
      .limit(CAP.wizard),
    // P1: quotes that lapsed in the last 60 days, with the estimate as it is now.
    supabase.from("crm_events")
      .select("id, account_id, estimate_id, occurred_at, payload, estimates(status, title, viewed_at)")
      .eq("type", "estimate_lapsed")
      .gte("occurred_at", new Date(now.getTime() - 60 * 86_400_000).toISOString())
      .order("occurred_at", { ascending: true })
      .limit(CAP.lapsed),
    // P3: what customers wrote to us in the last 30 days, matched or not.
    supabase.from("messages")
      .select("id, account_id, channel, subject, body, from_address, occurred_at, read_at")
      .eq("direction", "in")
      .gte("occurred_at", since30d)
      .order("occurred_at", { ascending: true })
      .limit(CAP.inbound),
    // P4/P7: a delay that ended is its own item — a state-bounded read, ordered by
    // when it ended. (Quiet states are looked up for the queue's own customers below,
    // not by scanning every non-active account.)
    supabase.from("accounts")
      .select("id, name, email, phone, relationship_state, state_until, state_note, state_reason")
      .eq("relationship_state", "delayed").lte("state_until", nowIso)
      .order("state_until", { ascending: true })
      .limit(300),
    loadCrmThresholds(supabase),
    supabase.from("visit_unmapped_suburbs")
      .select("id, suburb, postcode, first_seen_at, last_seen_at, hits, last_estimate_id")
      .is("resolved_at", null)
      .order("first_seen_at", { ascending: true })
      .limit(CAP.callbacks),
    supabase.from("visit_requests")
      .select("id, kind, account_id, estimate_id, zone, suburb, name, mobile, note, preferred_days, time_of_day, created_at, due_at")
      .is("answered_at", null)
      .order("due_at", { ascending: true })
      .limit(CAP.callbacks),
    supabase.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle(),
    supabase.from("visits")
      .select("id, account_id, estimate_id, starts_at, cancelled_at, cancel_reason, customer_name, suburb")
      .eq("status", "cancelled").eq("cancel_reason", "declined_invitation").gte("cancelled_at", since30d)
      .order("cancelled_at", { ascending: false }).limit(CAP.rebook),
    supabase.from("staff_gcal_events")
      .select("id, ref_id, staff_id, google_start, moved_seen_at, profiles!staff_gcal_events_staff_id_fkey(name)")
      .eq("kind", "visit").not("moved_seen_at", "is", null).is("moved_acknowledged_at", null).limit(CAP.rebook),
    supabase.from("staff_gcal_connections").select("staff_id, google_email, sync_error, scopes, profiles!staff_gcal_connections_staff_id_fkey(name)").limit(50),
    supabase.from("visit_zones").select("key, estimator_id, profiles!visit_zones_estimator_id_fkey(name)").limit(10),
  ]);
  const delayedRows = ((delayedAcc.error ? [] : (delayedAcc.data ?? [])) as Array<DelayedAccountRow & { relationship_state: string }>);
  const hit = (name: string, rows: unknown[] | null | undefined, cap: number) => { if ((rows?.length ?? 0) >= cap) truncated.push(name); };
  hit("follow-ups", snoozeAcc.data, CAP.followups); hit("invoices", invoices.data, CAP.invoices); hit("callbacks", callbacks.data, CAP.callbacks);
  hit("online estimates", wizardRows.data, CAP.wizard); hit("lapsed quotes", lapsedEvents.data, CAP.lapsed); hit("messages", inboundMsgs.data, CAP.inbound);
  // Tom, 15 Sep: every quote out with a customer, so the ones gone quiet
  // become follow-ups. Sent in the last 90 days — older ones have lapsed
  // (their own item) or are being ignored on purpose.
  const quoteRes = await supabase.from("estimates")
    .select("id, title, account_id, status, sent_at, created_at, viewed_at, total_cents, source")
    .eq("status", "sent").not("account_id", "is", null)
    .gte("sent_at", since90d)
    .order("sent_at", { ascending: false }).limit(CAP.quotes);
  const quoteRows = (quoteRes.error ? [] : (quoteRes.data ?? [])) as unknown as QuietQuoteRow[];
  hit("quotes out", quoteRows, CAP.quotes);
  // Tom, 7 Oct: who has said yes lately — the latest acceptance per customer
  // answers every follow-up asked for before it (quiet quote, callback, online
  // estimate). 90 days matches the quote window above; a read that fails
  // suppresses nothing, so a follow-up is shown rather than lost.
  const acceptRes = await supabase.from("estimates").select("account_id, accepted_at, created_at")
    .eq("status", "accepted").not("account_id", "is", null)
    .or(`accepted_at.gte.${since90d},and(accepted_at.is.null,created_at.gte.${since90d})`)
    .order("accepted_at", { ascending: false, nullsFirst: false }).limit(1000);
  if (acceptRes.error) truncated.push("acceptances: read failed");
  const acceptedAt = new Map<string, string>();
  for (const r of (acceptRes.error ? [] : (acceptRes.data ?? [])) as Array<{ account_id: string | null; accepted_at: string | null; created_at: string }>) {
    if (!r.account_id) continue;
    const at = r.accepted_at ?? r.created_at;
    const have = acceptedAt.get(r.account_id);
    if (!have || at > have) acceptedAt.set(r.account_id, at);
  }
  const quoteAccountIds = [...new Set(quoteRows.map((r) => r.account_id).filter(Boolean))];
  const [quoteAttempts, quoteAccounts] = await Promise.all([
    inSlices(quoteAccountIds, (ids) => supabase.from("crm_events").select("account_id, occurred_at")
      .in("type", [...CHASE_EVENT_TYPES]).in("account_id", ids).gte("occurred_at", since90d).limit(ids.length * 8)),
    inSlices(quoteAccountIds, (ids) => supabase.from("accounts").select("id, name, email, phone, temperature").in("id", ids)),
  ]);
  const quoteNames = new Map(((quoteAccounts) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>)
    .map((a) => [a.id, a.name || a.email || a.phone || "A customer"]));
  const quoteTemps = new Map(((quoteAccounts) as Array<{ id: string; temperature: string | null }>).map((a) => [a.id, a.temperature]));
  // Airtable handover (16 Sep): signed jobs whose feed had no per-area hours.
  const hoursRes = await supabase.from("estimates")
    .select("id, title, account_id, accepted_at, created_at, total_cents, external_ref")
    .eq("source", "paintscout").eq("status", "accepted").contains("external_ref", { hours_pending: true })
    .order("accepted_at", { ascending: true }).limit(200);
  const hoursRows = (hoursRes.error ? [] : (hoursRes.data ?? [])) as unknown as HoursPendingRow[];
  // Employed painters (S3): standing "can't make it" flags. Three bounded
  // reads; a table that predates 20270154 just yields nothing.
  const [flagRes, activeRes, moveRes] = await Promise.all([
    supabase.from("wo_events")
      .select("id, work_order_id, created_at, meta, work_orders(wo_ref, wo_snapshot)")
      .eq("type", "assignment_cant_make_it").gte("created_at", since30d)
      .order("created_at", { ascending: true }).limit(200),
    supabase.from("wo_assignments").select("id, contractor_id, start_date, end_date, status, work_order_id, accepted_at, work_orders(wo_ref, wo_snapshot)")
      .neq("status", "released").gte("end_date", new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)).limit(500),
    supabase.from("wo_events").select("created_at, meta")
      .eq("type", "assignment_dates_changed").gte("created_at", since30d).limit(500),
  ]);
  const flagRows = (flagRes.error ? [] : (flagRes.data ?? [])) as unknown as CantMakeItEventRow[];
  const activeRows = (activeRes.error ? [] : (activeRes.data ?? [])) as unknown as ActiveAssignmentRow[];
  const moveRows = (moveRes.error ? [] : (moveRes.data ?? [])) as unknown as DatesChangedEventRow[];
  // S7: undecided leave / RDO requests. Staff-only table; a session that
  // cannot read it gets nothing. (Clocked days no longer wait on anyone — 7 Oct 2026.)
  const leaveRes = await supabase.from("contractor_unavailability").select("id, contractor_id, kind, start_date, end_date, reason, created_at")
      .in("kind", ["leave", "rdo"]).is("approved_at", null).is("declined_at", null)
      .gte("end_date", now.toISOString().slice(0, 10)).order("start_date", { ascending: true }).limit(200);
  const leaveRows = (leaveRes.error ? [] : (leaveRes.data ?? [])) as LeaveRequestRow[];
  // Tom, 1 Oct: open holds starting within the week, and whether their job
  // has since been booked (which resolves them). Staff-only table; a table
  // that predates 20270209 simply yields nothing.
  const todayMel = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const holdRes = await supabase.from("schedule_holds")
    .select("id, contractor_id, start_date, end_date, work_order_id, note, created_at, released_at, work_orders(wo_ref, wo_snapshot)")
    .is("released_at", null)
    .gte("end_date", todayMel)
    .lte("start_date", new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + HOLD_NUDGE_DAYS * 86_400_000)))
    .order("start_date", { ascending: true }).limit(200);
  const holdRows = (holdRes.error ? [] : (holdRes.data ?? [])) as unknown as HoldQueueRow[];
  const holdWoIds = [...new Set(holdRows.map((h) => h.work_order_id).filter((x): x is string => !!x))];
  const [holdOffers, holdAssignments] = await Promise.all([
    inSlices(holdWoIds, (ids) => supabase.from("booking_offers").select("work_order_id").in("work_order_id", ids).in("state", ["offered", "proposed", "accepted"])),
    inSlices(holdWoIds, (ids) => supabase.from("wo_assignments").select("work_order_id").in("work_order_id", ids).neq("status", "released")),
  ]);
  const holdBooked = new Set<string>([...holdOffers, ...holdAssignments].map((r) => (r as { work_order_id: string }).work_order_id));
  // Tom, 25 Sep: customer check-ins on running jobs, and the after-job call on
  // short ones. Built here so the keys exist for dismissals; SHOWN on PC
  // Command (homeOf = "pc"), not on Today.
  const checkinRes = await readJobCheckinRows(supabase, now);
  if (checkinRes.error) truncated.push("job_checkins: read failed");
  const checkinRows = checkinRes.rows;
  const flagPainterIds = [...new Set([
    ...flagRows.map((f) => f.meta?.contractor_id),
    ...activeRows.filter((a) => !a.accepted_at).map((a) => a.contractor_id),
    ...leaveRows.map((r) => r.contractor_id),
    ...holdRows.map((h) => h.contractor_id),
  ].filter((x): x is string => !!x))];
  const flagPainters = await inSlices(flagPainterIds, (ids) => supabase.from("contractors").select("id, company_name, profiles(name)").in("id", ids));
  const painterNames = new Map((flagPainters as unknown as Array<{ id: string; company_name: string | null; profiles: { name: string | null } | null }>)
    .map((c) => [c.id, c.profiles?.name || c.company_name || "A painter"]));
  // Tom, 7 Sep: open estimates still waiting on the estimator's photo sign-off.
  const photoRes = await supabase.from("estimates")
    .select("id, title, account_id, created_at, status, builder_state")
    .eq("status", "draft").contains("builder_state", { aiDeferred: [{ kind: "photo_review" }] })
    .gte("created_at", new Date(now.getTime() - 60 * 86_400_000).toISOString())
    .order("created_at", { ascending: false }).limit(100);
  const photoRows = (photoRes.error ? [] : (photoRes.data ?? [])) as unknown as PhotoReviewRow[];
  /**
   * §5 (⚑7) · C5: the confirmation queue, FROM THE TABLE.
   *
   * This used to scan `estimates` for a jsonb marker
   * (`builder_state.prepPack.kind = 'desk_check'`). It now reads the rows that
   * record the promise itself, joined to the estimate for the money and the
   * name. Open states only — a fixed or declined request is history, and the
   * turnaround warning chases the open ones.
   */
  const deskRes = await supabase.from("confirmation_requests")
    .select("id, estimate_id, requested_at, kind, status, suggested_action, assigned_to, estimates(title, account_id, total_cents, builder_state)")
    .in("status", ["requested", "question_asked"])
    .limit(200);
  const deskRows = (deskRes.error ? [] : (deskRes.data ?? [])) as unknown as DeskCheckRow[];
  // The turnaround the customer was promised — the same row the hand-off screen
  // reads, so the queue cannot chase a different number than the one we gave.
  const deskTurnaround = await supabase
    .from("settings").select("value").eq("key", "confirmation_turnaround").maybeSingle()
    .then((r) => turnaroundFromSettings((r.data as { value?: unknown } | null)?.value));
  const deskPolicy: WizardPolicySettings = await supabase
    .from("settings").select("key, value").eq("key", "wizard_policy").maybeSingle()
    .then((r) => (r.data ? policyFromSettings(settingValue([r.data as { key: string; value: unknown }], "wizard_policy")) : DEFAULT_POLICY));
  // P6: visits that didn't happen, and any booking since (which closes them).
  const since60d = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const [rebookRes, laterRes] = await Promise.all([
    supabase.from("visits").select("id, account_id, status, starts_at, outcome_at, updated_at, customer_name, address, customer_phone, outcome_note")
      .in("status", ["no_show", "rebook"]).gte("updated_at", since60d).order("updated_at", { ascending: true }).limit(CAP.rebook),
    supabase.from("visits").select("account_id, starts_at, created_at").eq("status", "booked").gte("created_at", since60d).limit(500),
  ]);
  const rebookRows = (rebookRes.error ? [] : (rebookRes.data ?? [])) as RebookVisitRow[];
  const laterBooked = (laterRes.error ? [] : (laterRes.data ?? [])) as Array<{ account_id: string | null; starts_at: string; created_at: string }>;
  const inboundRows = (inboundMsgs.error ? [] : (inboundMsgs.data ?? [])) as unknown as InboundMessageRow[];
  const inboundAccountIds = [...new Set(inboundRows.map((m) => m.account_id).filter((x): x is string => Boolean(x)))];
  const [outboundTouches, inboundAttempts, inboundAccounts] = await Promise.all([
    inSlices(inboundAccountIds, (ids) => supabase.from("messages").select("account_id, occurred_at, sender_role").eq("direction", "out")
      .not("status", "in", "(failed,not_configured,suppressed)").not("sender_role", "in", "(system,assistant)")
      .in("account_id", ids).gte("occurred_at", since30d).limit(ids.length * 8)),
    inSlices(inboundAccountIds, (ids) => supabase.from("crm_events").select("account_id, occurred_at")
      .in("type", ["call_connected", "call_no_answer", "message_left"]).in("account_id", ids).gte("occurred_at", since30d).limit(ids.length * 5)),
    inSlices(inboundAccountIds, (ids) => supabase.from("accounts").select("id, name, email, phone").in("id", ids)),
  ]);
  const inboundNames = new Map(((inboundAccounts) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>)
    .map((a) => [a.id, a.name || a.email || a.phone || "A customer"]));
  const lapsedRows = (lapsedEvents.error ? [] : (lapsedEvents.data ?? [])) as unknown as LapsedEventRow[];
  const lapsedAccountIds = [...new Set(lapsedRows.map((r) => r.account_id).filter(Boolean))];
  const [lapsedAttempts, lapsedAccounts] = await Promise.all([
    inSlices(lapsedAccountIds, (ids) => supabase.from("crm_events").select("account_id, occurred_at")
      .in("type", [...CHASE_EVENT_TYPES]).in("account_id", ids)
      .gte("occurred_at", new Date(now.getTime() - 60 * 86_400_000).toISOString()).limit(ids.length * 5)),
    inSlices(lapsedAccountIds, (ids) => supabase.from("accounts").select("id, name, email, phone").in("id", ids)),
  ]);
  const lapsedNames = new Map(((lapsedAccounts) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>)
    .map((a) => [a.id, a.name || a.email || a.phone || "A customer"]));
  const wzRows = (wizardRows.error ? [] : (wizardRows.data ?? [])) as unknown as WizardQueueRow[];
  const wzAccountIds = [...new Set(wzRows.map((r) => r.account_id).filter((x): x is string => Boolean(x)))];
  const wzAttempts = await inSlices(wzAccountIds, (ids) => supabase.from("crm_events").select("account_id, occurred_at")
    .in("type", ["call_connected", "call_no_answer", "message_left"]).in("account_id", ids).gte("occurred_at", since30d).limit(ids.length * 5));
  // A change request is answered by a staff reply in that estimate's thread.
  const crRows = ((changeReqs.error ? [] : changeReqs.data) ?? []) as unknown as ChangeRequestRow[];
  const crEstimateIds = [...new Set(crRows.map((r) => r.estimate_id))];
  const staffReplies = await inSlices(crEstimateIds, (ids) => supabase.from("estimate_messages").select("estimate_id, created_at").eq("direction", "staff").in("estimate_id", ids).gte("created_at", since90d).limit(ids.length * 5));

  // Callback items need the later call attempts and the names — two more
  // bounded reads, only when there are callbacks to judge.
  const cbRows = (callbacks.data ?? []) as CallbackEventRow[];
  const cbAccountIds = [...new Set(cbRows.map((c) => c.account_id))];
  const [attempts, cbAccounts] = await Promise.all([
    inSlices(cbAccountIds, (ids) => supabase.from("crm_events").select("account_id, occurred_at")
      .in("type", ["call_connected", "call_no_answer", "message_left"]).in("account_id", ids).gte("occurred_at", since90d).limit(ids.length * 5)),
    inSlices(cbAccountIds, (ids) => supabase.from("accounts").select("id, name, email").in("id", ids)),
  ]);

  // Snooze reasons live in the event log, not on the account row.
  const snoozeRows = (snoozeAcc.data ?? []) as SnoozeAccountRow[];
  const snoozedIds = snoozeRows.filter((a) => a.snoozed_until).map((a) => a.id);
  const reasons = await inSlices(snoozedIds, (ids) => supabase.from("crm_events")
    .select("account_id, payload, occurred_at").eq("type", "snoozed").in("account_id", ids).order("occurred_at", { ascending: false }).limit(ids.length * 3));

  type InvJoin = {
    id: string; estimate_id: string; kind: string; status: string;
    total_inc_cents: number; due_on: string | null; issued_on: string | null;
    estimates: { account_id: string | null; accepted_name: string | null; title: string | null; job_address: string | null } | null;
  };
  const invRows: QueueInvoiceRow[] = ((invoices.data ?? []) as unknown as InvJoin[]).map((r) => ({
    id: r.id,
    estimateId: r.estimate_id,
    kind: r.kind as DeriveInvoice["kind"],
    status: r.status as DeriveInvoice["status"],
    totalIncCents: r.total_inc_cents,
    dueOn: r.due_on,
    issuedOn: r.issued_on,
    accountId: r.estimates?.account_id ?? null,
    customerName: r.estimates?.accepted_name ?? r.estimates?.title ?? null,
    jobAddress: r.estimates?.job_address ?? null,
  }));
  const invIds = invRows.map((r) => r.id);
  const payRows = await inSlices(invIds, (ids) => supabase.from("payments").select("invoice_id, amount_cents, status, paid_on").in("invoice_id", ids));
  const payments: DerivePayment[] = ((payRows) as Array<{ invoice_id: string; amount_cents: number; status: string; paid_on: string | null }>)
    .map((p) => ({ invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on }));

  const names = new Map(((cbAccounts) as Array<{ id: string; name: string | null; email: string }>)
    .map((a) => [a.id, a.name || a.email]));

  // S5: the visits behind "moved in Google" mapping rows (ref_id carries no FK, so no embed).
  const movedIds = ((movedEvents.error ? [] : (movedEvents.data ?? [])) as Array<{ ref_id: string }>).map((r) => r.ref_id);
  const movedVisits = movedIds.length
    ? (await inSlices(movedIds, (ids) => supabase.from("visits").select("id, starts_at, status, account_id, estimate_id, customer_name").in("id", ids))) as Array<{ id: string; starts_at: string; status: string; account_id: string | null; estimate_id: string | null; customer_name: string | null }>
    : [];

  const raw = [
    ...buildSnoozeItems(snoozeRows, reasons as SnoozeReasonRow[], now),
    ...buildInvoiceItems(invRows, payments, now),
    ...buildCallbackItems(cbRows, attempts as ContactEventRow[], names, now, acceptedAt),
    ...buildApprovalItem(queued.count ?? 0, now),
    ...buildMessageApprovalItem(pendingHolds.error ? 0 : pendingHolds.count ?? 0, now),
    ...buildChangeRequestItems(crRows, staffReplies as StaffReplyRow[], now),
    ...buildHandoffItems(((handoffs.error ? [] : handoffs.data) ?? []) as unknown as HandoffQueueRow[], now),
    ...buildWizardItems(wzRows, wzAttempts as ContactEventRow[], now, acceptedAt),
    ...buildLapsedItems(lapsedRows, lapsedAttempts as ContactEventRow[], lapsedNames, now),
    ...buildQuietQuoteItems(quoteRows, quoteAttempts as ContactEventRow[], quoteNames, thresholds, now, quoteTemps, acceptedAt),
    ...buildHoursPendingItems(hoursRows, now),
    // A read that fails before migration 20270212 is on the database adds nothing (same shape as handoffs above).
    ...buildUnmappedSuburbItems(((unmappedSuburbs.error ? [] : unmappedSuburbs.data) ?? []) as UnmappedSuburbRow[], now),
    ...buildVisitRequestItems(((visitRequests.error ? [] : visitRequests.data) ?? []) as unknown as VisitRequestRow[], now),
    ...buildHolidaysItem(bookingRules.error ? [] : mergeBookingRules(bookingRules.data?.value).publicHolidays, now),
    ...buildDeclinedVisitItems(((declinedVisits.error ? [] : declinedVisits.data) ?? []) as unknown as DeclinedVisitRow[], now),
    ...buildMovedVisitItems(movedRows(movedEvents.error ? [] : (movedEvents.data ?? []), movedVisits), now),
    ...buildGcalFailedItems(connRows(gcalConns.error ? [] : (gcalConns.data ?? [])), now),
    ...buildCalendarMissingItems(
      ((zoneEstimators.error ? [] : (zoneEstimators.data ?? [])) as unknown as Array<{ key: string; estimator_id: string | null; profiles?: { name?: string | null } | null }>).map((z) => ({ key: z.key, estimator_id: z.estimator_id, estimator_name: z.profiles?.name ?? null })),
      connRows(gcalConns.error ? [] : (gcalConns.data ?? [])),
      bookingRules.error ? false : mergeBookingRules(bookingRules.data?.value).calendarRequired, now),
    ...buildEmployeeReassignItems(flagRows, activeRows, moveRows, painterNames, now),
    ...buildEmployeeUnacceptedItems(activeRows, painterNames, now),
    ...buildLeaveRequestItems(leaveRows, painterNames, now),
    ...buildHoldItems(holdRows, holdBooked, painterNames, now),
    ...buildJobCheckinItems(checkinRows, now),
    ...buildMessageItems(inboundRows, outboundTouches as OutboundTouchRow[], inboundAttempts as ContactEventRow[], inboundNames, now, thresholds.messageOverdueHours),
    ...buildDelayEndedItems(delayedRows, now),
    ...buildRebookItems(rebookRows, laterBooked, now),
    ...buildPhotoReviewItems(photoRows, now),
    ...buildDeskCheckItems(deskRows, deskPolicy, now, deskTurnaround),
  ];

  // P7: the states and owners of the customers actually on the queue — a
  // lookup by id, never a scan of every non-active account.
  const rawAccountIds = [...new Set(raw.map((i) => i.accountId).filter((x): x is string => !!x))];
  const quietIds = new Set<string>();
  const ownerOf = new Map<string, string | null>();
  const accs = await inSlices(rawAccountIds, (ids) => supabase.from("accounts").select("id, relationship_state, state_until, owner_id").in("id", ids));
  for (const a of accs as Array<{ id: string; relationship_state: string; state_until: string | null; owner_id: string | null }>) {
    if (isQuiet(a.relationship_state, a.state_until, now)) quietIds.add(a.id);
    ownerOf.set(a.id, a.owner_id ?? null);
  }
  for (const i of raw) if (i.accountId) i.ownerId = ownerOf.get(i.accountId) ?? null;

  // Until migration 20261217 runs, the dismissals table doesn't exist and the
  // read errors; the queue must still stand up (house law: inert-but-safe).
  const dismissals = (dismissed.error ? [] : (dismissed.data ?? [])) as Dismissal[];

  // The CRM's queue: Today, the badge, the dashboard. PC-homed kinds are built
  // (their keys are what dismissals hang off) and then handed to PC Command.
  return assembleQueue(crmItems(suppressQuiet(raw, quietIds)), dismissals, now, truncated);
}

// ---- C7b: the estimates page's view of the queue ----------------------------

/**
 * "Waiting on you" on /estimates (C7b) is THIS queue, narrowed to the subjects
 * that page is about. It lives here, beside the evaluator, so the tab and CRM
 * Today are provably the same list: both call `getWorkQueue()` and this is
 * the only thing between the two renders. No second query, badge or count.
 */
export function estimatesPageItems(items: readonly WorkItem[]): WorkItem[] {
  // Tom, 15 Sep: a quote to chase (followup_due) is a CRM job, not an
  // estimator's — it stays on Today and off the Waiting tab, which Tom was
  // tidying the same day.
  return items.filter((i) => i.kind !== "followup_due" && (i.subjectRef.type === "estimate" || i.subjectRef.type === "wizard_session"));
}
