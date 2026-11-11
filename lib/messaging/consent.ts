/**
 * Automations brief ruling A‑E (Tom, 11 Nov 2026): STOP reaches automations.
 *
 * A customer's "no" to marketing lives in three places on `accounts`: the
 * STOP reply sets `marketing_unsubscribed_at` and `permit_sms = 'declined'`
 * (`app/api/sms/inbound/route.ts`), and the office can set `permit_email` /
 * `permit_sms` on the record. Campaigns honoured them; automations read only
 * `notify_prefs`, so a promotional automation would still have gone out.
 *
 * This is the one rule for a MARKETING send (a registry key with
 * `consent: "marketing"`). A service message — the estimate they asked for,
 * a visit reminder, an invoice — is not marketing and is not stopped here;
 * the customer's own per-kind switches (`notify_prefs`) still apply to those.
 * Pure.
 */
export type MarketingConsent = {
  permit_email?: string | null;
  permit_sms?: string | null;
  marketing_unsubscribed_at?: string | null;
};

/** Why a marketing message on this channel must not go, or null when it may. */
export function marketingRefusal(acct: MarketingConsent, channel: "email" | "sms"): string | null {
  if (acct.marketing_unsubscribed_at) {
    return "Customer unsubscribed from marketing (replied STOP or unsubscribed) — marketing messages are not sent.";
  }
  const permit = channel === "sms" ? acct.permit_sms : acct.permit_email;
  if (permit === "declined") {
    return `Customer said no to marketing ${channel === "sms" ? "texts" : "email"} — not sent.`;
  }
  return null;
}
