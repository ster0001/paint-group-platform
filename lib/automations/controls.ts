/**
 * Per-automation controls (Tom's brief, 16 Sep 2026, Session 1) — CLIENT-SAFE.
 *
 * Every automation on Settings → Automations carries, beside its on/off
 * switch: a CHANNEL (Text / Email / Both, among the channels it supports), a
 * MODE (send automatically / office approves first), and TIMING numbers where
 * the registry declares them. All three live on the `messaging` settings row
 * under `controls[key]`; an absent entry means the registry default, so an
 * office that never touches the screen gets exactly the behaviour shipped.
 *
 * Alongside them, two site-wide rules for AUTOMATIC customer and painter
 * messages (decisions D1, D2): quiet hours — a message due outside them is
 * held and released at the next opening — and a daily cap per customer. Both
 * have exemptions the registry declares per automation (an offer, a receipt,
 * a sign-off message must not wait).
 *
 * Pure module: no Supabase, no env. The dispatcher (lib/automations/
 * dispatch.ts, server) asks these questions; the settings screen renders them.
 */
import { melbourneParts, melbourneInstant } from "@/lib/time/businessHours";

export type SendChannel = "email" | "sms";
/** What the office picks for an automation; `both` = every supported channel. */
export type ChannelChoice = "email" | "sms" | "both";
export type SendMode = "auto" | "approve";

export type AutomationControl = {
  channel?: ChannelChoice;
  mode?: SendMode;
  /** Registry `timing[].id` → value, in the unit the registry states. */
  timing?: Record<string, number>;
};

/** [open, close) hours in Melbourne wall-clock time; null = no sending that day. */
export type QuietWindow = [number, number] | null;
export type QuietHours = { weekday: QuietWindow; saturday: QuietWindow; sunday: QuietWindow };

/** D1: 8am–7pm weekdays, 9am–5pm Saturday, nothing Sunday. */
export const DEFAULT_QUIET_HOURS: QuietHours = { weekday: [8, 19], saturday: [9, 17], sunday: null };
/** D2: three automatic job messages per customer per Melbourne day. */
export const DEFAULT_DAILY_CAP = 3;

export const CHANNEL_CHOICE_LABEL: Record<ChannelChoice, string> = { email: "Email", sms: "Text", both: "Both" };
export const MODE_LABEL: Record<SendMode, string> = { auto: "Send automatically", approve: "Office approves first" };

/** The choices an automation can be set to, given the channels it supports. */
export function channelChoicesFor(supports: readonly string[]): ChannelChoice[] {
  const email = supports.includes("email");
  const sms = supports.includes("sms");
  if (email && sms) return ["both", "email", "sms"];
  if (email) return ["email"];
  if (sms) return ["sms"];
  return [];
}

/** A stored choice is only honoured if the automation supports it; otherwise the default. */
export function normaliseChannel(choice: ChannelChoice | undefined, supports: readonly string[], fallback: ChannelChoice): ChannelChoice {
  const allowed = channelChoicesFor(supports);
  if (choice && allowed.includes(choice)) return choice;
  return allowed.includes(fallback) ? fallback : allowed[0] ?? fallback;
}

export type ChannelPlan = {
  /** Channels to actually use, in send order. Empty = nothing can be sent. */
  channels: SendChannel[];
  /** D3: the chosen channel had no contact detail; this says what happened. */
  fallback?: string;
};

/**
 * Which channels to send on, given the office's choice and what we know about
 * the recipient. D3: when the chosen channel is impossible (no mobile on file
 * for Text, no email for Email) we fall back to the other supported channel
 * and say so, rather than sending nothing in silence.
 */
export function planChannels(
  choice: ChannelChoice,
  supports: readonly string[],
  contact: { email?: string | null; phone?: string | null },
): ChannelPlan {
  const canEmail = supports.includes("email") && Boolean(contact.email?.trim());
  const canSms = supports.includes("sms") && Boolean(contact.phone?.trim());
  if (choice === "both") {
    const channels: SendChannel[] = [];
    if (canSms) channels.push("sms");
    if (canEmail) channels.push("email");
    return { channels };
  }
  if (choice === "sms") {
    if (canSms) return { channels: ["sms"] };
    if (canEmail) return { channels: ["email"], fallback: "No mobile on file — sent by email instead." };
    return { channels: [] };
  }
  if (canEmail) return { channels: ["email"] };
  if (canSms) return { channels: ["sms"], fallback: "No email on file — sent by text instead." };
  return { channels: [] };
}

// ---- quiet hours -----------------------------------------------------------

function windowFor(q: QuietHours, weekday: number): QuietWindow {
  if (weekday === 0) return q.sunday;
  if (weekday === 6) return q.saturday;
  return q.weekday;
}

/** Defensive read of the stored value: anything malformed → the default. */
export function parseQuietHours(raw: unknown): QuietHours {
  const out: QuietHours = { ...DEFAULT_QUIET_HOURS };
  if (!raw || typeof raw !== "object") return out;
  for (const k of ["weekday", "saturday", "sunday"] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === null) { out[k] = null; continue; }
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n >= 0 && n <= 24) && v[0] < v[1]) {
      out[k] = [v[0], v[1]];
    }
  }
  return out;
}

/** True when `at` falls inside a sending window (Melbourne wall clock). */
export function withinSendingHours(at: Date, q: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const p = melbourneParts(at);
  const w = windowFor(q, p.weekday);
  if (!w) return false;
  const hour = p.h + p.min / 60;
  return hour >= w[0] && hour < w[1];
}

/**
 * The next instant a sending window opens at or after `at`. Inside a window
 * this is `at` itself. Searches up to 14 days so an all-null configuration
 * cannot spin; it then returns `at` (better to send than to hold forever).
 */
export function nextSendingOpen(at: Date, q: QuietHours = DEFAULT_QUIET_HOURS): Date {
  if (withinSendingHours(at, q)) return at;
  let p = melbourneParts(at);
  for (let i = 0; i < 14; i++) {
    const w = windowFor(q, p.weekday);
    if (w) {
      const open = melbourneInstant(p.y, p.m, p.d, Math.floor(w[0]), Math.round((w[0] % 1) * 60));
      if (open.getTime() > at.getTime()) return open;
    }
    // Roll to the next Melbourne day, at noon to keep clear of DST edges, and re-read the date.
    const noon = melbourneInstant(p.y, p.m, p.d, 12);
    p = melbourneParts(new Date(noon.getTime() + 24 * 3_600_000));
  }
  return at;
}

/** Start of `at`'s Melbourne calendar day, as an instant — the daily-cap bucket. */
export function melbourneDayStart(at: Date): Date {
  const p = melbourneParts(at);
  return melbourneInstant(p.y, p.m, p.d, 0);
}

/** The Melbourne calendar date, YYYY-MM-DD (never toISOString — CLAUDE.md). */
export function melbourneDateKey(at: Date): string {
  const p = melbourneParts(at);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// ---- SMS length -------------------------------------------------------------

// GSM 03.38 basic set + the extension characters that cost two septets.
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export type SmsLength = { chars: number; encoding: "GSM-7" | "Unicode"; parts: number; perPart: number };

/** How many text-message parts a body costs — the counter beside the SMS box. */
export function smsLength(body: string): SmsLength {
  let septets = 0;
  let unicode = false;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const chars = [...body].length;
    const perPart = chars <= 70 ? 70 : 67;
    return { chars, encoding: "Unicode", parts: chars === 0 ? 0 : Math.ceil(chars / perPart), perPart };
  }
  const perPart = septets <= 160 ? 160 : 153;
  return { chars: septets, encoding: "GSM-7", parts: septets === 0 ? 0 : Math.ceil(septets / perPart), perPart };
}

// ---- preview ----------------------------------------------------------------

/**
 * A realistic example job for the live preview, so no raw {{token}} ever
 * shows. Every placeholder any registry entry lists must have a value here —
 * registry.test pins it.
 */
export const SAMPLE_VARS: Record<string, string> = {
  first_name: "Sarah", name: "Sarah Chen", customer_name: "Sarah Chen", company_name: "Paint Group",
  estimate_title: "12 Elm Grove, Thornbury", job_title: "12 Elm Grove, Thornbury", address: "12 Elm Grove, Thornbury",
  suburb: "Thornbury", total: "$4,850.00", deposit: "$485.00", amount: "$1,200.00", estimator_name: "Tom",
  link: "https://paintgroup.com.au/e/example", start_date: "Mon 5 Oct", painter_name: "Marco Rossi", painter_first_name: "Marco",
  walkthrough_line: "Your final walkthrough is booked for Fri 9 Oct at 3:00 pm.", walkthrough_when: "Fri 9 Oct, 3:00 pm",
  wo_ref: "WO-1042", action: "accept", visit_when: "Tue 22 Sep, 10:00 am", signed_by: " by Sarah Chen",
  invoice_number: "INV-2041", receipt_number: "R-0331", remittance_number: "RA-0117", contractor_company: "Rossi Painting",
  bank_reference: " (ref PG-1042)", next_step: "Your estimate is waiting on your account page.", where: "12 Elm Grove, Thornbury",
  page: "the colours page", accepted_name: "Sarah Chen", accepted_at: "16 Sep 2026, 2:14 pm",
  painter: "Marco Rossi", job: "12 Elm Grove, Thornbury", note_line: "", proposed_line: "", reason_line: "", method: "card",
  who: "Sarah Chen", category: "rot repair", comment: "Sill on the north window is soft.", hours_line: "", due_date: "Fri 2 Oct",
  expiry_time: "6:00 pm", access_notes: "Side gate, key in lockbox 4471", colour_status: "Dulux Natural White, confirmed",
  days_overdue: "7", deposit_line: " Your deposit invoice is ready to pay: https://paintgroup.com.au/i/example",
  reminder: "Your job is finished and the photos are ready to look through. When you have a moment, please have a look and let us know you are happy.",
  hours_since: "74",
  review_link: "https://g.page/r/example", agency_name: "Northcote Property Co", agency_line: " for Northcote Property Co",
};

/** Placeholders present in a template that the preview cannot fill. */
export function unfilledPlaceholders(template: string, vars: Record<string, string> = SAMPLE_VARS): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!(m[1] in vars)) out.add(m[1]);
  return [...out];
}
