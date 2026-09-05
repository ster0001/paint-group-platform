/**
 * The CRM event vocabulary and its payloads (brief rev 2 §2, session 2.1).
 *
 * `crm_events` is the ONE log. Every timeline, segment, campaign trigger and
 * attribution figure reads it, so what may be written — and what shape each
 * payload takes — is settled here rather than at each call site.
 *
 * The database checks the SHAPE of a type name and nothing more, deliberately
 * (see the migration's note 1: a CHECK listing every type costs a migration
 * per new event). Membership of the catalogue below is enforced on the way in,
 * by `buildEvent`, and pinned by unit tests.
 *
 * Adding an event type is: a line in CRM_EVENT_TYPES, a payload schema, and a
 * line in the timeline's label map. Nothing else.
 */

import { z } from "zod";

/** Who caused it. Mirrors the column's CHECK. */
export const EVENT_SOURCES = ["system", "staff", "customer", "ai"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

const money = z.number().int().min(0).max(100_000_000);
const shortText = z.string().trim().min(1).max(2000);

/**
 * The catalogue. Grouped by who writes it, because that is what determines
 * whether a payload can be trusted for pricing or only for reading.
 *
 * Site-capture, referral and reward events (rev 2's table) are deliberately
 * ABSENT: they belong to briefs that are not in this repo, and a half-guessed
 * payload shape in the one log is worse than no event at all.
 */
export const CRM_EVENT_SCHEMAS = {
  // ---- the job's own lifecycle, written by the system it happens in -------
  wizard_started: z.object({ jobType: z.string().max(20).optional(), mode: z.enum(["customer", "internal"]).optional() }),
  wizard_abandoned: z.object({ lastStep: z.number().int().min(1).max(12), emailCaptured: z.boolean() }),
  /** Buckets brief §3: "I'm stuck, call me" from any wizard page. */
  wizard_help_requested: z.object({ phone: z.string().max(30).optional(), note: shortText.optional(), page: z.string().max(40).optional() }),
  /** Buckets brief §3: "Talk to a person" in the assistant — the question text rides along for the human reply. */
  wizard_question_asked: z.object({ phone: z.string().max(30).optional(), note: shortText.optional(), page: z.string().max(40).optional() }),
  /** Homepage v2 §5: every marketing-site event (nav_cta, see_price, faq_open …)
   *  as one type, the event name in the payload. `address` is present ONLY on
   *  see_price (the sink strips it elsewhere); `visitorId` is the first-party
   *  cookie that lets lead-source attribution join a later wizard draft. */
  web_event: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
    props: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}),
    path: z.string().max(300).default("/"),
    visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().default(null),
    address: z.string().max(250).nullable().default(null),
  }),
  estimate_built: z.object({ totalCents: money, accuracyPct: z.number().min(0).max(100).optional(), rooms: z.number().int().min(0).optional() }),
  estimate_sent: z.object({ totalCents: money, channel: z.enum(["email", "sms", "both", "link"]), validDays: z.number().int().min(1).max(365).optional() }),
  estimate_viewed: z.object({ viewNumber: z.number().int().min(1).optional(), secondsOnPage: z.number().int().min(0).optional() }),
  estimate_revised: z.object({ revision: z.number().int().min(1), totalCents: money }),
  estimate_accepted: z.object({ totalCents: money, depositCents: money.optional() }),
  estimate_declined: z.object({ reason: shortText.optional() }),
  visit_booked: z.object({ when: z.string().max(40), who: z.string().max(80).optional() }),
  visit_completed: z.object({ outcome: shortText.optional() }),
  job_started: z.object({ workOrderNo: z.string().max(30).optional() }),
  job_completed: z.object({ workOrderNo: z.string().max(30).optional() }),
  invoice_sent: z.object({ invoiceNo: z.string().max(30).optional(), amountCents: money }),
  invoice_paid: z.object({ invoiceNo: z.string().max(30).optional(), amountCents: money }),

  // ---- staff activity: the mockup's "Log something" chips -----------------
  call_no_answer: z.object({ note: shortText.optional(), voicemail: z.boolean().default(false) }),
  message_left: z.object({ note: shortText.optional() }),
  call_connected: z.object({ note: shortText.optional() }),
  note_added: z.object({ body: shortText }),
  followup_set: z.object({ dueAt: z.string().datetime(), note: shortText.optional() }),
  temperature_set: z.object({ temperature: z.enum(["hot", "warm", "cold"]), previous: z.enum(["hot", "warm", "cold"]).nullable().default(null) }),
  snoozed: z.object({ until: z.string().datetime(), reason: shortText.optional() }),
  /** A derived work item waved away (shell brief §3.7). The reason is required
   *  because repeated dismissals of one kind are how a wrong threshold shows. */
  work_item_dismissed: z.object({ itemKey: z.string().max(200), reason: shortText, until: z.string().datetime().nullable().default(null) }),

  // ---- the customer reaching in ------------------------------------------
  website_chat: z.object({ excerpt: shortText.optional(), answered: z.boolean().default(false) }),
  callback_requested: z.object({ phone: z.string().max(30).optional(), note: shortText.optional() }),
  /** Ticked "looking for advice" on the wizard's colours question (1 Sep) —
   *  the office follows up with the colour consultant. */
  colour_advice_requested: z.object({ brands: z.array(z.string().max(20)).max(6).default([]) }),
  /** A text they sent back — surfaced on the timeline, answered by a human. */
  sms_reply: z.object({ body: shortText }),
  cta_clicked: z.object({ campaignKey: z.string().max(60), linkKey: z.string().max(60).optional() }),

  // ---- campaigns ----------------------------------------------------------
  campaign_enrolled: z.object({ campaignKey: z.string().max(60), segmentKey: z.string().max(60).optional() }),
  campaign_message_queued: z.object({ campaignKey: z.string().max(60), step: z.number().int().min(1), channel: z.enum(["email", "sms"]) }),
  campaign_message_approved: z.object({ campaignKey: z.string().max(60), step: z.number().int().min(1) }),
  campaign_message_sent: z.object({ campaignKey: z.string().max(60), step: z.number().int().min(1), channel: z.enum(["email", "sms"]) }),
  campaign_message_cancelled: z.object({ campaignKey: z.string().max(60), step: z.number().int().min(1), reason: shortText }),
  campaign_unsubscribed: z.object({ campaignKey: z.string().max(60).optional(), channel: z.enum(["email", "sms"]) }),
  campaign_bounced: z.object({ campaignKey: z.string().max(60), channel: z.enum(["email", "sms"]), hard: z.boolean().default(false) }),

  // ---- attribution --------------------------------------------------------
  first_touch_recorded: z.object({ source: z.string().max(40), detail: z.string().max(200).optional() }),
  source_overridden: z.object({ from: z.string().max(40), to: z.string().max(40), reason: shortText }),

  // ---- offers made in a campaign, honoured on an estimate -----------------
  offer_granted: z.object({ offerKey: z.string().max(60), expiresAt: z.string().datetime(), valueCents: money.optional() }),
  offer_applied: z.object({ offerKey: z.string().max(60), valueCents: money.optional() }),
  offer_expired: z.object({ offerKey: z.string().max(60) }),
} as const;

export type CrmEventType = keyof typeof CRM_EVENT_SCHEMAS;
export const CRM_EVENT_TYPES = Object.keys(CRM_EVENT_SCHEMAS) as CrmEventType[];

/** The type-name shape the database enforces; mirrored so a bad name fails
 *  in a unit test rather than in Postgres. */
export const TYPE_NAME_SHAPE = /^[a-z][a-z0-9_]{2,48}$/;

export function isCrmEventType(t: string): t is CrmEventType {
  return Object.prototype.hasOwnProperty.call(CRM_EVENT_SCHEMAS, t);
}

export type CrmEventInput = {
  type: CrmEventType;
  accountId?: string | null;
  propertyId?: string | null;
  estimateId?: string | null;
  workOrderId?: string | null;
  invoiceId?: string | null;
  source?: EventSource;
  /** When it HAPPENED. Defaults to now; a note about Friday's call carries
   *  Friday, so the timeline reads in the order events occurred. */
  occurredAt?: Date | string | null;
  payload?: unknown;
  dedupeKey?: string | null;
};

export type BuiltEvent = {
  p_type: string;
  p_account_id: string | null;
  p_payload: Record<string, unknown>;
  p_source: EventSource;
  p_occurred_at: string | null;
  p_estimate_id: string | null;
  p_work_order_id: string | null;
  p_invoice_id: string | null;
  p_property_id: string | null;
  p_dedupe_key: string | null;
};

/**
 * Validate and shape one event for `crm_log_event`. Throws on an unknown type
 * or a payload that doesn't match its schema — a malformed event in the one
 * log is worse than a failed write, because everything downstream trusts it.
 */
export function buildEvent(input: CrmEventInput): BuiltEvent {
  if (!isCrmEventType(input.type)) {
    throw new Error(`Unknown CRM event type: ${String(input.type)}`);
  }
  const parsed = CRM_EVENT_SCHEMAS[input.type].safeParse(input.payload ?? {});
  if (!parsed.success) {
    throw new Error(`CRM event ${input.type}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const occurred = input.occurredAt == null ? null
    : input.occurredAt instanceof Date ? input.occurredAt.toISOString()
    : new Date(input.occurredAt).toISOString();

  return {
    p_type: input.type,
    p_account_id: input.accountId ?? null,
    p_payload: parsed.data as Record<string, unknown>,
    p_source: input.source ?? "system",
    p_occurred_at: occurred,
    p_estimate_id: input.estimateId ?? null,
    p_work_order_id: input.workOrderId ?? null,
    p_invoice_id: input.invoiceId ?? null,
    p_property_id: input.propertyId ?? null,
    p_dedupe_key: input.dedupeKey ?? null,
  };
}

/**
 * The idempotency key. Every sweep and every webhook builds one from the
 * facts that make the event unique — never from a timestamp taken at write
 * time, or running the sweep twice writes twice.
 *
 *   dedupeKey("estimate_viewed", estimateId, "3")
 *   dedupeKey("campaign", campaignKey, accountId, "step2")
 */
export function dedupeKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== "")
    .map((p) => String(p).trim().toLowerCase().replace(/\s+/g, "-"))
    .join(":")
    .slice(0, 200);
}

/** The minimum a client must offer to write an event — so callers can pass a
 *  session client, a service client, or a stub in a test. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Write one event. Returns its id, or null when the write was refused —
 * logging is never allowed to break the thing it is recording, so callers
 * treat a null as "not logged" and carry on.
 */
export async function logCrmEvent(db: RpcClient, input: CrmEventInput): Promise<string | null> {
  const args = buildEvent(input);
  const { data, error } = await db.rpc("crm_log_event", args);
  if (error) return null;
  return typeof data === "string" ? data : null;
}
