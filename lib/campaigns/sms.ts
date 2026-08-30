/**
 * Marketing text messages (campaign channel "sms").
 *
 * The engine modelled the channel from day one — steps, queue and guard all
 * carry email|sms — so this file is the content layer: what a marketing text
 * is allowed to look like, and the one path that sends it.
 *
 * Three rules the channel lives by:
 *
 *  · Every message identifies the sender and carries an opt-out. The renderer
 *    appends "Reply STOP to opt out" itself, exactly as the email renderer
 *    writes the unsubscribe link — never the writer's job to remember. A STOP
 *    reply lands at Twilio; ⚑ wiring it back to marketing_unsubscribed_at
 *    needs an inbound webhook, an open gap named in crm-decisions.
 *
 *  · Same guard chain as email. Unsubscribed, open work, frequency, quiet
 *    hours — all checked at send time by the same code. Frequency counts a
 *    text and an email as the same thing: one marketing touch.
 *
 *  · Per-recipient links work here too: {{estimate}} and {{account}} resolve
 *    exactly as in email, because "open your estimate" is the whole point of
 *    most texts this business would send.
 */

import { sendSms } from "@/lib/messaging/send";

/** ~2 segments of plain GSM text. A marketing SMS longer than this is a
 *  letter wearing the wrong envelope. */
export const SMS_MAX_CHARS = 320;

export const SMS_OPT_OUT = "Reply STOP to opt out";

/**
 * An Australian mobile, into E.164.
 *
 * Accepts what people actually type — "0455 221 908", "+61 455 221 908",
 * "61455221908" — and refuses landlines and junk rather than letting Twilio
 * fail with a code nobody in the office can read.
 */
export function toE164Au(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  let n = digits;
  if (n.startsWith("+")) n = n.slice(1);
  if (n.startsWith("61")) n = "0" + n.slice(2);
  // Mobiles only: 04xx xxx xxx. A landline cannot receive an SMS reliably,
  // and "delivered to a fax machine" is not a campaign anyone meant to run.
  if (!/^04\d{8}$/.test(n)) return null;
  return "+61" + n.slice(1);
}

/** GSM-7 or unicode, and how many segments the network will bill. */
export function smsParts(body: string): { chars: number; parts: number; unicode: boolean } {
  // The GSM-7 basic set, near enough: anything outside it (emoji, smart
  // quotes, em dashes) forces UCS-2 and thirds the per-part budget.
  const unicode = /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]/.test(body);
  const chars = body.length;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const parts = chars <= single ? (chars === 0 ? 0 : 1) : Math.ceil(chars / multi);
  return { chars, parts, unicode };
}

/**
 * The body as it will actually leave: tokens filled, sender named, opt-out
 * present. Idempotent about the opt-out — a writer who typed it themselves
 * doesn't get it twice.
 */
export function renderSms(
  body: string,
  opts: { estimateUrl?: string | null; accountUrl: string; companyName?: string },
): string {
  const estimate = opts.estimateUrl || opts.accountUrl;
  let out = body
    .replaceAll("{{estimate}}", estimate)
    .replaceAll("{{account}}", opts.accountUrl)
    .replaceAll("{{unsubscribe}}", "")   // an email token; STOP is the SMS answer
    .trim();

  const company = opts.companyName || "Paint Group";
  if (!new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(out)) {
    out = `${company}: ${out}`;
  }
  if (!/\bSTOP\b/i.test(out)) {
    out = `${out}\n${SMS_OPT_OUT}`;
  }
  return out;
}

export type SmsSendResult = { ok: true; id: string } | { ok: false; error: string };

/** One marketing text. Already-guarded, like sendCampaignEmail — every
 *  "should we?" question was answered before this is called. */
export async function sendCampaignSms(input: {
  toRawPhone: string | null | undefined;
  body: string;
  links: { estimateUrl?: string | null; accountUrl: string };
  companyName?: string;
}): Promise<SmsSendResult> {
  const to = toE164Au(input.toRawPhone);
  if (!to) return { ok: false, error: "No usable mobile number on file — needs an 04xx number." };

  const rendered = renderSms(input.body, { ...input.links, companyName: input.companyName });
  if (rendered.length > SMS_MAX_CHARS + 60) {
    return { ok: false, error: "That text is far too long — trim it or send an email instead." };
  }

  const result = await sendSms({ to, body: rendered });
  if (result.status === "sent") return { ok: true, id: result.id ?? "" };
  if (result.status === "not_configured") return { ok: false, error: "SMS isn't configured on this server (Twilio keys)." };
  return { ok: false, error: result.message ?? "The SMS service refused it." };
}
