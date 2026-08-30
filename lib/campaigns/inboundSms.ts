/**
 * What a customer texts BACK (the STOP webhook's brain).
 *
 * The gap this closes, recorded in crm-decisions since the SMS channel
 * shipped: "Reply STOP to opt out" was a promise the system couldn't keep —
 * Twilio received the reply and nothing wrote marketing_unsubscribed_at.
 *
 * Pure module: keyword classification, phone matching and the signature
 * check live here where tests can hold them; the route stays thin.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { toE164Au } from "./sms";

/**
 * The industry-standard keywords, exactly as carriers and Twilio treat them.
 * Matching is the WHOLE message (trimmed), not a substring — "please don't
 * stop the great work" is not an opt-out, and treating it as one would be a
 * consent record that says something the customer didn't.
 */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export type InboundKind = "stop" | "start" | "help" | "other";

export function classifyInbound(body: string | null | undefined): InboundKind {
  const word = String(body ?? "").trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return "other";
}

/**
 * Twilio's request signature: HMAC-SHA1 over the exact public URL followed by
 * every POST parameter, sorted by name, name-then-value, base64. Anyone can
 * POST to a public route; only Twilio holds the auth token that signs it —
 * without this check, one curl command could unsubscribe every customer.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Which accounts a reply belongs to. Phones are stored as people typed them
 * ("0455 221 908"), so both sides normalise to E.164 before comparing. Every
 * match is returned: two accounts sharing a mobile both said STOP.
 *
 * ⚑ At volume this in-memory pass wants a stored phone_e164 column; honest
 * and fast at hundreds of accounts, noted for the 25k gate.
 */
export function matchAccountsByPhone<T extends { phone: string | null }>(
  accounts: T[],
  fromE164: string,
): T[] {
  return accounts.filter((a) => toE164Au(a.phone) === fromE164);
}

/** TwiML, because the reply to a compliance keyword is itself regulated. */
export function twimlReply(message: string): string {
  const esc = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}

export function twimlEmpty(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
