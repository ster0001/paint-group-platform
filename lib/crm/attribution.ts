/**
 * Where the work came from (session 2.4).
 *
 * Two jobs, kept apart on purpose:
 *   · RESOLVE — turn whatever the browser knows (utm tags, a click id, the
 *     referring site) into one of a short list of sources the office actually
 *     talks about. Pure, and the only place raw params are interpreted.
 *   · CARRY — the first touch is kept forever and never overwritten; the last
 *     touch changes every visit. Both ride to the server with the estimate.
 *
 * The mockup's Lead sources tab reports FIRST touch — "every enquiry is tagged
 * on arrival, or asked directly if it can't be" — so that is what the report
 * reads. Last touch is captured anyway, because the day someone asks "what
 * closed it" the data has to already exist. ⚑ C13 (taxonomy final) and C14
 * (which model reports) are open; both are one edit to this file.
 */

import { z } from "zod";

/** The list the office speaks in. Order is the report's order. */
export const SOURCES = [
  { key: "referral", label: "Referral" },
  { key: "repeat_customer", label: "Repeat customer" },
  { key: "paid_google", label: "Paid Google" },
  { key: "organic_search", label: "Organic search" },
  { key: "paid_social", label: "Paid social" },
  { key: "social", label: "Social" },
  { key: "email", label: "Email" },
  { key: "sign_or_vehicle", label: "Sign or vehicle" },
  { key: "phone", label: "Phone enquiry" },
  { key: "direct", label: "Direct" },
  { key: "other", label: "Other" },
  { key: "unknown", label: "Not recorded" },
] as const;

export type SourceKey = (typeof SOURCES)[number]["key"];
export const SOURCE_KEYS = SOURCES.map((s) => s.key) as SourceKey[];

export function sourceLabel(key: string): string {
  return SOURCES.find((s) => s.key === key)?.label ?? "Not recorded";
}

export const touchSchema = z.object({
  source: z.enum(SOURCE_KEYS as [SourceKey, ...SourceKey[]]),
  /** The evidence, kept so a wrong guess can be argued with: "google / cpc",
   *  "domain.com.au", "utm_campaign=spring-ext". */
  detail: z.string().max(200).default(""),
  /** Where they landed. Useful once there are landing pages. */
  path: z.string().max(200).default(""),
  at: z.string().datetime(),
});
export type Touch = z.infer<typeof touchSchema>;

export const attributionSchema = z.object({
  first: touchSchema.nullable().default(null),
  last: touchSchema.nullable().default(null),
}).default({ first: null, last: null });
export type Attribution = z.infer<typeof attributionSchema>;

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia)\./i;
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|linkedin|tiktok|pinterest|youtube|reddit|t)\.(com|co|me)$/i;
const OWN_HOSTS = /(^|\.)(paintgroup\.com\.au|paint-group-platform\.vercel\.app|localhost)$/i;

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
};

/**
 * One arrival → one source.
 *
 * Read in the order a marketer would trust: an explicit utm tag beats a click
 * id beats the referring site, because the tag is the only one the business
 * controls. A referral param is treated as a referral no matter what else is
 * on the URL — a customer forwarding a link from a friend is not "direct".
 */
export function resolveSource(input: {
  params?: Record<string, string | undefined> | URLSearchParams;
  referrer?: string | null;
  path?: string | null;
}): { source: SourceKey; detail: string } {
  const get = (k: string): string => {
    const p = input.params;
    if (!p) return "";
    const v = p instanceof URLSearchParams ? p.get(k) : p[k];
    return (v ?? "").toString().trim().toLowerCase();
  };

  const medium = get("utm_medium");
  const utmSource = get("utm_source");
  const campaign = get("utm_campaign");
  const detailOf = (...bits: string[]) => bits.filter(Boolean).join(" · ").slice(0, 200);

  // An explicit referral link always wins — it is a person, not a channel.
  if (get("ref") || get("referral") || utmSource === "referral" || medium === "referral") {
    return { source: "referral", detail: detailOf(get("ref") || get("referral") || utmSource, campaign) };
  }

  if (utmSource || medium) {
    const paid = /cpc|ppc|paid|ads?/.test(medium);
    if (/google|adwords/.test(utmSource)) return { source: paid ? "paid_google" : "organic_search", detail: detailOf(utmSource, medium, campaign) };
    if (/facebook|instagram|meta|tiktok|linkedin/.test(utmSource)) return { source: paid ? "paid_social" : "social", detail: detailOf(utmSource, medium, campaign) };
    if (/email|newsletter|klaviyo|mailchimp|resend/.test(utmSource) || medium === "email") return { source: "email", detail: detailOf(utmSource, campaign) };
    if (/sign|vehicle|van|truck|board/.test(utmSource)) return { source: "sign_or_vehicle", detail: detailOf(utmSource, campaign) };
    if (paid) return { source: "other", detail: detailOf(utmSource, medium, campaign) };
    return { source: "other", detail: detailOf(utmSource, medium, campaign) };
  }

  // A click id with no tags: the ad platform sent them, the tagging just failed.
  if (get("gclid") || get("gbraid") || get("wbraid")) return { source: "paid_google", detail: "gclid" };
  if (get("fbclid")) return { source: "paid_social", detail: "fbclid" };
  if (get("msclkid")) return { source: "other", detail: "microsoft ads" };

  const host = hostOf(input.referrer ?? "");
  if (!host) return { source: "direct", detail: "" };
  if (OWN_HOSTS.test(host)) return { source: "direct", detail: host };
  if (SEARCH_HOSTS.test(host)) return { source: "organic_search", detail: host };
  if (SOCIAL_HOSTS.test(host)) return { source: "social", detail: host };
  return { source: "other", detail: host };
}

/**
 * Fold a new arrival into what is already known.
 *
 * The rule that matters: the FIRST touch is written once and never again. A
 * customer who finds you through a friend, thinks about it for a month, then
 * arrives via a Google ad is a referral that cost you an ad click — not a
 * Google lead. Overwriting first touch is how paid channels quietly take
 * credit for word of mouth.
 */
export function recordTouch(existing: Attribution | null, touch: Touch): Attribution {
  const prior = existing ?? { first: null, last: null };
  return {
    first: prior.first ?? touch,
    last: touch,
  };
}

/** A touch from the current page, ready to store. */
export function touchFromLocation(now: Date, loc: { search: string; pathname: string }, referrer: string | null): Touch {
  const { source, detail } = resolveSource({
    params: new URLSearchParams(loc.search),
    referrer,
    path: loc.pathname,
  });
  return { source, detail, path: loc.pathname.slice(0, 200), at: now.toISOString() };
}

/** What the report shows per source. */
export type SourceRow = {
  source: SourceKey;
  label: string;
  leads: number;
  won: number;
  revenueCents: number;
};

/**
 * The Lead sources table. Counts every account with a first touch, how many of
 * them have an accepted job, and what those jobs were worth.
 *
 * Accounts with nothing recorded are NOT dropped — they land under "Not
 * recorded", because a report that silently omits the untagged half tells you
 * the tagged half is everything.
 */
export function sourceReport(
  rows: Array<{ source: SourceKey | null; wonCents: number | null }>,
): { rows: SourceRow[]; totals: { leads: number; won: number; revenueCents: number } } {
  const byKey = new Map<SourceKey, SourceRow>();
  for (const s of SOURCES) byKey.set(s.key, { source: s.key, label: s.label, leads: 0, won: 0, revenueCents: 0 });

  for (const r of rows) {
    const key: SourceKey = r.source ?? "unknown";
    const row = byKey.get(key) ?? byKey.get("unknown")!;
    row.leads += 1;
    if (r.wonCents != null && r.wonCents > 0) {
      row.won += 1;
      row.revenueCents += r.wonCents;
    }
  }

  const out = [...byKey.values()].filter((r) => r.leads > 0);
  return {
    rows: out,
    totals: {
      leads: out.reduce((n, r) => n + r.leads, 0),
      won: out.reduce((n, r) => n + r.won, 0),
      revenueCents: out.reduce((n, r) => n + r.revenueCents, 0),
    },
  };
}
