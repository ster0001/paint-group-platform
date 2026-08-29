/**
 * "Everything, in order" — the customer timeline (session 2.2).
 *
 * The mockup's Customer tab is one column of rows, each with a label, a time,
 * and a line of detail underneath. This turns `crm_events` rows into exactly
 * that, and it is the ONLY place an event type becomes English: the board, the
 * customer page and any future digest all read these labels, so a wording
 * change happens once.
 *
 * Pure. No client, no fetch — the page reads the rows and passes them in.
 */

import { isCrmEventType, type CrmEventType, type EventSource } from "./events";

export type TimelineRow = {
  id: string;
  type: string;
  /** The heading: "Estimate opened", "Called — no answer". */
  label: string;
  /** The line underneath, already written out. Empty when there is nothing
   *  worth saying — a bare label reads better than a padded one. */
  detail: string;
  occurredAt: string;
  source: EventSource;
  /** Groups the row for styling: what the office DID vs what the customer did
   *  vs what the system recorded. The mockup tints these differently. */
  kind: "activity" | "customer" | "system" | "campaign";
};

type RawEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  source: string;
};

const money = (cents: unknown): string => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return `$${Math.round(n / 100).toLocaleString("en-AU")}`;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Join the parts that actually have a value. Every detail line goes through
 *  this: a payload missing a field must drop its clause, not leave a dangling
 *  " · step undefined" or a bare "inc. GST" on screen. */
const join = (...parts: unknown[]): string =>
  parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean).join(" · ");

/** A number that is actually there, or "". */
const num = (v: unknown): string => (Number.isFinite(Number(v)) ? String(Number(v)) : "");

/** label + how to write the detail line, one entry per catalogued type. */
const RENDER: Record<CrmEventType, { label: string; kind: TimelineRow["kind"]; detail?: (p: Record<string, unknown>) => string }> = {
  // ---- the job's lifecycle ------------------------------------------------
  wizard_started: { label: "Started the estimate wizard", kind: "customer",
    detail: (p) => str(p.jobType) ? `${str(p.jobType)} job` : "" },
  wizard_abandoned: { label: "Left the wizard unfinished", kind: "customer",
    detail: (p) => join(num(p.lastStep) && `Reached step ${num(p.lastStep)}`,
      p.emailCaptured ? "email captured" : "no email") },
  estimate_built: { label: "Estimate built", kind: "system",
    detail: (p) => join(money(p.totalCents), num(p.rooms) && `${num(p.rooms)} rooms`,
      num(p.accuracyPct) && `confidence ${num(p.accuracyPct)}%`) },
  estimate_sent: { label: "Estimate sent", kind: "activity",
    detail: (p) => join(money(p.totalCents) && `${money(p.totalCents)} inc. GST`,
      str(p.channel) === "both" ? "SMS + email" : str(p.channel),
      num(p.validDays) && `valid ${num(p.validDays)} days`) },
  estimate_viewed: { label: "Estimate opened", kind: "customer",
    detail: (p) => {
      const nth = Number(p.viewNumber);
      const times = nth === 2 ? "Second time." : nth === 3 ? "Third time." : nth > 3 ? `${nth}th time.` : "";
      const mins = Number(p.secondsOnPage) >= 60 ? `${Math.round(Number(p.secondsOnPage) / 60)} minutes on the page.` : "";
      return [times, mins].filter(Boolean).join(" ");
    } },
  estimate_revised: { label: "Revised estimate sent", kind: "activity",
    detail: (p) => join(num(p.revision) && `Revision ${num(p.revision)}`, money(p.totalCents)) },
  estimate_accepted: { label: "Estimate accepted", kind: "customer",
    detail: (p) => join(money(p.totalCents), p.depositCents ? `deposit ${money(p.depositCents)}` : "") },
  estimate_declined: { label: "Estimate declined", kind: "customer", detail: (p) => str(p.reason) },
  visit_booked: { label: "Visit booked", kind: "activity",
    detail: (p) => join(str(p.when), str(p.who)) },
  visit_completed: { label: "Visit done", kind: "activity", detail: (p) => str(p.outcome) },
  job_started: { label: "Job started", kind: "system", detail: (p) => str(p.workOrderNo) },
  job_completed: { label: "Job completed", kind: "system", detail: (p) => str(p.workOrderNo) },
  invoice_sent: { label: "Invoice sent", kind: "system",
    detail: (p) => join(str(p.invoiceNo), money(p.amountCents)) },
  invoice_paid: { label: "Invoice paid", kind: "system",
    detail: (p) => join(str(p.invoiceNo), money(p.amountCents)) },

  // ---- what the office did ------------------------------------------------
  call_no_answer: { label: "Called — no answer", kind: "activity",
    detail: (p) => join(p.voicemail ? "Voicemail left" : "No voicemail left", str(p.note)) },
  message_left: { label: "Left a message", kind: "activity", detail: (p) => str(p.note) },
  call_connected: { label: "Spoke to customer", kind: "activity", detail: (p) => str(p.note) },
  note_added: { label: "Note", kind: "activity", detail: (p) => str(p.body) },
  followup_set: { label: "Follow-up set", kind: "activity",
    detail: (p) => join(whenWords(str(p.dueAt)), str(p.note)) },
  temperature_set: { label: "Marked", kind: "activity",
    detail: (p) => {
      const now = str(p.temperature);
      if (!now) return "";
      const shown = now[0].toUpperCase() + now.slice(1);
      return str(p.previous) ? `${shown} — was ${str(p.previous)}` : shown;
    } },
  snoozed: { label: "Snoozed", kind: "activity",
    detail: (p) => join(whenWords(str(p.until)), str(p.reason)) },

  // ---- the customer reaching in -------------------------------------------
  website_chat: { label: "Chat on the website", kind: "customer",
    detail: (p) => [str(p.excerpt), p.answered ? "" : "Not answered yet."].filter(Boolean).join(" — ") },
  callback_requested: { label: "Asked for a callback", kind: "customer",
    detail: (p) => join(str(p.phone), str(p.note)) },
  cta_clicked: { label: "Clicked a campaign link", kind: "customer",
    detail: (p) => str(p.campaignKey) },

  // ---- campaigns ----------------------------------------------------------
  campaign_enrolled: { label: "Added to a campaign", kind: "campaign", detail: (p) => str(p.campaignKey) },
  campaign_message_queued: { label: "Message waiting for approval", kind: "campaign",
    detail: (p) => join(str(p.campaignKey), num(p.step) && `step ${num(p.step)}`, str(p.channel)) },
  campaign_message_approved: { label: "Message approved", kind: "campaign",
    detail: (p) => join(str(p.campaignKey), num(p.step) && `step ${num(p.step)}`) },
  campaign_message_sent: { label: "Campaign message sent", kind: "campaign",
    detail: (p) => join(str(p.campaignKey), num(p.step) && `step ${num(p.step)}`, str(p.channel)) },
  campaign_message_cancelled: { label: "Message stopped before sending", kind: "campaign",
    detail: (p) => join(str(p.campaignKey), str(p.reason)) },
  campaign_unsubscribed: { label: "Unsubscribed", kind: "campaign", detail: (p) => str(p.channel) },
  campaign_bounced: { label: "Message bounced", kind: "campaign",
    detail: (p) => join(str(p.channel), p.hard ? "hard bounce" : "") },

  // ---- attribution and offers ---------------------------------------------
  first_touch_recorded: { label: "First touch", kind: "system",
    detail: (p) => [str(p.source), str(p.detail)].filter(Boolean).join(" — ") },
  source_overridden: { label: "Source corrected", kind: "activity",
    detail: (p) => join(str(p.from) && str(p.to) ? `${str(p.from)} → ${str(p.to)}` : "", str(p.reason)) },
  offer_granted: { label: "Offer made", kind: "campaign",
    detail: (p) => join(str(p.offerKey), p.valueCents ? money(p.valueCents) : "",
      whenWords(str(p.expiresAt)) && `expires ${whenWords(str(p.expiresAt))}`) },
  offer_applied: { label: "Offer used", kind: "system",
    detail: (p) => join(str(p.offerKey), p.valueCents ? money(p.valueCents) : "") },
  offer_expired: { label: "Offer expired", kind: "system", detail: (p) => str(p.offerKey) },
};

/** "3 Sep", or "today" / "tomorrow" when it is close enough to say so. */
function whenWords(iso: string, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Events → timeline rows, newest first.
 *
 * An event type the catalogue doesn't know still renders — as its own name,
 * tidied. A row the office can't read is better than a row that vanishes,
 * because a vanished row makes the timeline quietly wrong.
 */
export function buildTimeline(events: ReadonlyArray<RawEvent>): TimelineRow[] {
  return [...events]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .map((e) => {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const render = isCrmEventType(e.type) ? RENDER[e.type] : null;
      const label = render?.label ?? e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      let detail = "";
      try {
        detail = render?.detail?.(payload) ?? "";
      } catch {
        detail = "";   // a malformed payload must never break the page
      }
      return {
        id: e.id,
        type: e.type,
        label,
        detail: detail.trim(),
        occurredAt: e.occurred_at,
        source: (["system", "staff", "customer", "ai"].includes(e.source) ? e.source : "system") as EventSource,
        kind: render?.kind ?? "system",
      };
    });
}

/** The timeline's own clock: "Today 08:42", "Yest 20:15", "26 Aug 16:30" —
 *  the mockup's three forms, in that order. */
export function timelineStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yest ${time}`;
  return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} ${time}`;
}
