/**
 * Personalisation tokens (P5, deep dive §4.3.7). SERVER ONLY for the loader;
 * the fill is pure.
 *
 * A writer types {{first_name}} and the sender puts "Sarah" there. Eight
 * tokens, listed in TOKENS so the studios can offer them as chips rather than
 * asking anyone to remember the spelling. The three link tokens
 * ({{estimate}}, {{account}}, {{unsubscribe}}) are filled by the senders
 * themselves — they need URLs, not words — and are left alone here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Template } from "./blocks";

export type TokenValues = {
  first_name: string;
  name: string;
  suburb: string;
  estimate_total: string;
  last_job_date: string;
  estimator: string;
  company: string;
};

export const TOKENS: Array<{ token: keyof TokenValues; label: string; example: string }> = [
  { token: "first_name", label: "First name", example: "Sarah" },
  { token: "name", label: "Full name", example: "Sarah Chen" },
  { token: "suburb", label: "Suburb", example: "Kew" },
  { token: "estimate_total", label: "Estimate total", example: "$4,350" },
  { token: "last_job_date", label: "Last job", example: "March 2024" },
  { token: "estimator", label: "Estimator's name", example: "Tom" },
  { token: "company", label: "Company", example: "Paint Group" },
];

const LINK_TOKENS = new Set(["estimate", "account", "unsubscribe"]);

/** Every {{token}} filled; an unknown one is left as typed so it is visible in a test send. */
export function fillTokens(text: string, v: TokenValues): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    if (LINK_TOKENS.has(key)) return whole;
    const val = (v as Record<string, string>)[key];
    return val == null ? whole : val;
  });
}

/** Subject, preheader and every wording field of every block — never a URL. */
export function personaliseTemplate(t: Template, v: TokenValues): Template {
  const fill = (s: string) => fillTokens(s, v);
  return {
    subject: fill(t.subject),
    preheader: fill(t.preheader),
    blocks: t.blocks.map((b) => {
      switch (b.kind) {
        case "hero": return { ...b, headline: fill(b.headline), sub: fill(b.sub) };
        case "text": return { ...b, body: fill(b.body) };
        case "photo": return { ...b, caption: fill(b.caption) };
        case "beforeAfter": return { ...b, caption: fill(b.caption) };
        case "bullets": return { ...b, heading: fill(b.heading), items: b.items.map(fill) };
        case "quote": return { ...b, body: fill(b.body), attribution: fill(b.attribution) };
        case "button": return { ...b, label: fill(b.label), note: fill(b.note) };
        case "offer": return { ...b, headline: fill(b.headline), detail: fill(b.detail) };
        case "signoff": return { ...b, body: fill(b.body), name: fill(b.name) };
        case "divider": return b;
      }
    }),
  };
}

export const firstNameOf = (name: string | null | undefined): string => {
  const clean = String(name ?? "").trim().replace(/^(mr|mrs|ms|dr)\.?\s+/i, "");
  const first = clean.split(/[\s&,/]+/)[0] ?? "";
  // "sarah@…" or a phone number is not a first name.
  return /^[A-Za-z][A-Za-z'’-]*$/.test(first) ? first : "";
};

export const money = (cents: number | null | undefined): string =>
  cents == null ? "" : "$" + Math.round(cents / 100).toLocaleString("en-AU");

export const monthYear = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "Australia/Melbourne" }) : "";

/** Pure: the values from what the caller already holds. */
export function tokenValues(input: {
  name: string | null; suburb: string | null; estimateTotalCents: number | null;
  lastJobCompletedAt: string | null; estimator: string | null; company: string;
}): TokenValues {
  return {
    first_name: firstNameOf(input.name),
    name: String(input.name ?? "").trim(),
    suburb: String(input.suburb ?? "").trim(),
    estimate_total: money(input.estimateTotalCents),
    last_job_date: monthYear(input.lastJobCompletedAt),
    estimator: String(input.estimator ?? "").trim() || input.company,
    company: input.company,
  };
}

/** The values for one recipient: the facts row, the newest sent estimate's author, the company name. */
export async function recipientTokens(db: SupabaseClient, accountId: string, company: string): Promise<TokenValues> {
  const [{ data: facts }, { data: est }] = await Promise.all([
    db.from("crm_account_facts").select("name, suburb, quoted_cents, last_job_completed_at").eq("account_id", accountId).maybeSingle(),
    db.from("estimates").select("total_cents, created_by, profiles:created_by(name)").eq("account_id", accountId)
      .not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const estimator = ((est?.profiles as { name?: string | null } | null)?.name ?? null);
  return tokenValues({
    name: (facts?.name as string | null) ?? null,
    suburb: (facts?.suburb as string | null) ?? null,
    estimateTotalCents: (est?.total_cents as number | null) ?? (facts?.quoted_cents as number | null) ?? null,
    lastJobCompletedAt: (facts?.last_job_completed_at as string | null) ?? null,
    estimator,
    company,
  });
}
