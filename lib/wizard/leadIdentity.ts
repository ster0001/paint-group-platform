/**
 * The wizard's per-visitor cap (`wizard_limits.maxEstimatesPerVisitor`, 2 a
 * day by default) counts a visitor's `wizard_leads` rows — and WHO the
 * visitor is decides whose rows count.
 *
 * Tom, 2 Nov 2026: "it keeps coming up with Looks like you're busy even if I
 * put in a new email and phone number … it's supposed to block the same user
 * with the same details." The filter was `email OR ip_hash`, so a second
 * person on the same connection — or the same person with new details — was
 * counted against the first one's runs. A visitor who gave an email is now
 * identified by that email alone; the IP hash identifies only an emailless
 * run (a desktop range read before any details), where it is all we have.
 *
 * PostgREST's `or=` filter is comma/bracket-delimited and `contact.email` is
 * only length-checked, so an address carrying `,` or `(` would rewrite the
 * filter (18 Sep audit: a bogus column made the count query 400, the dropped
 * error read as "0 estimates" — no limit at all). An unsafe address counts
 * by IP, like the emailless run.
 */
export function leadIdentityFilter(email: string, ipHash: string): string {
  const safeEmail = /^[^,()]+$/.test(email) ? email.trim().toLowerCase() : "";
  return safeEmail ? `email.eq.${safeEmail}` : `ip_hash.eq.${ipHash}`;
}
