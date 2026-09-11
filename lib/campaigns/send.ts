/**
 * Delivering a campaign email (session 3.8). SERVER ONLY.
 *
 * Deliberately separate from the transactional sender in lib/messaging: a
 * different Resend account, a different domain (mail.paintgroup.com.au), and a
 * different key. If a campaign to three hundred people collects complaints, the
 * damage lands there and not on the domain that carries estimates and invoices
 * — the emails that must always arrive.
 *
 * This module cannot decide to send. It is handed one already-guarded message
 * and does the mechanical part; every "should we?" question lives in
 * guard.ts, and every message still passes through it first.
 */

import { recordMessage } from "@/lib/messaging/record";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderEmail, renderPlainText, type Brand, type Template } from "./blocks";
import { trackLinks } from "./links";

export const MARKETING_FROM = "hello@mail.paintgroup.com.au";
export const MARKETING_REPLY_TO = "info@paintgroup.com.au";
export const MARKETING_FROM_NAME = "Paint Group";

/** Vercel carries RESEND_API_KEY_MARKETING; the older local name is accepted
 *  so a machine that has one and not the other still works. */
function marketingKey(): string | null {
  return process.env.RESEND_API_KEY_MARKETING || process.env.RESEND_MARKETING_API_KEY || null;
}

/**
 * The unsubscribe link, signed rather than stored.
 *
 * An HMAC over the account id means no table, no token to leak in a backup,
 * and no way to unsubscribe someone else by editing a number in a URL. The
 * secret never leaves the server.
 */
function unsubscribeSecret(): string {
  return process.env.MARKETING_UNSUBSCRIBE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "development-only-unsubscribe-secret";
}

export function unsubscribeToken(accountId: string): string {
  const mac = createHmac("sha256", unsubscribeSecret()).update(accountId).digest("base64url").slice(0, 32);
  return `${accountId}.${mac}`;
}

/** Null when the token is wrong, forged, or malformed. */
export function accountFromToken(token: string): string | null {
  const [accountId, mac] = String(token ?? "").split(".");
  if (!accountId || !mac) return null;
  const expected = unsubscribeToken(accountId).split(".")[1];
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? accountId : null;
}

export function unsubscribeUrl(accountId: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://paintgroup.com.au").replace(/\/$/, "");
  return `${base}/u/${unsubscribeToken(accountId)}`;
}

export type SendInput = {
  /** P3: the queue row this delivery is for — the messages row links to it. */
  campaignMessageId?: string | null;
  to: string;
  template: Template;
  brand?: Partial<Brand>;
  /** The account this is going to, so the unsubscribe link is theirs. */
  accountId: string;
  /** Per-recipient link targets for the {{estimate}} / {{estimate_in_account}}
   *  / {{account}} button
   *  tokens. Resolved by the caller (it has the database); absent tokens fall
   *  back to the account page, which is always safe to land on. */
  links?: { estimateUrl?: string | null; accountUrl?: string | null };
  /** Prefixes the subject in a test so nobody mistakes it for the real thing. */
  isTest?: boolean;
  baseUrl?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The per-recipient LINK substitutions, as one function over a string — so the
 * HTML and the plain-text part cannot drift, and so the resolution is testable
 * without a send. (The wording tokens are personalise.ts's job.)
 *
 * {{estimate}}            their newest sent estimate
 * {{estimate_in_account}} the same estimate, opened inside their account
 * {{account}}             their account
 *
 * No estimate to link? The account page is where their saved work lives, so
 * the button still lands somewhere true rather than 404ing.
 */
export function fillLinkTokens(urls: {
  unsubscribe: string;
  accountUrl: string;
  estimateUrl: string | null;
}): (v: string) => string {
  const estimate = urls.estimateUrl || urls.accountUrl;
  // ?portal=1 puts a "← My account" link on the estimate, so the button lands
  // them IN their account rather than at a loose document. With nothing sent
  // the fallback is already the account page, which needs no flag.
  const estimateInAccount = urls.estimateUrl
    ? `${urls.estimateUrl}${urls.estimateUrl.includes("?") ? "&" : "?"}portal=1`
    : urls.accountUrl;
  return (v: string) => v
    .replaceAll("{{unsubscribe}}", urls.unsubscribe)
    .replaceAll("{{estimate_in_account}}", estimateInAccount)
    .replaceAll("{{estimate}}", estimate)
    .replaceAll("{{account}}", urls.accountUrl);
}

/**
 * One email. Both parts, always — a marketing HTML email with no plain-text
 * alternative is a spam signal before anyone has even read it.
 */
export async function sendCampaignEmail(input: SendInput): Promise<SendResult> {
  const key = marketingKey();
  if (!key) return { ok: false, error: "No marketing email key is set on this server." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return { ok: false, error: "That isn't an email address." };

  // Named, because the List-Unsubscribe header below carries the same URL.
  const link = unsubscribeUrl(input.accountId, input.baseUrl);
  const base = (input.baseUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://paintgroup.com.au").replace(/\/$/, "");
  const fill = fillLinkTokens({
    unsubscribe: link,
    accountUrl: input.links?.accountUrl || `${base}/account`,
    estimateUrl: input.links?.estimateUrl ?? null,
  });
  // P5: every button and link in a real campaign send goes through /t/<token>,
  // which is where `cta_clicked` and the click count come from. A test send
  // and a message with no queue row keep their plain links.
  const rendered = fill(renderEmail(input.template, { ...defaultBrand(), ...input.brand } as Brand));
  const html = input.campaignMessageId && !input.isTest ? trackLinks(rendered, base, input.campaignMessageId) : rendered;
  const text = fill(renderPlainText(input.template, { ...defaultBrand(), ...input.brand } as Brand));

  const subject = input.isTest ? `[TEST] ${input.template.subject}` : input.template.subject;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${MARKETING_FROM_NAME} <${MARKETING_FROM}>`,
        reply_to: MARKETING_REPLY_TO,
        to: [input.to],
        subject,
        html,
        text,
        // The header every mail client reads for its own unsubscribe button.
        // Offering it is the single cheapest thing you can do for inbox
        // placement — and someone who uses it never marks you as spam.
        headers: {
          "List-Unsubscribe": `<${link}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    const id = String((body as { id?: string }).id ?? "");
    await recordMessage({
      channel: "email", direction: "out", subject, body: text, bodyHtml: html,
      provider: "resend", providerMessageId: res.ok && id ? id : null,
      status: res.ok ? "sent" : "failed", toAddress: input.to, fromAddress: MARKETING_FROM,
      accountId: input.accountId, campaignMessageId: input.campaignMessageId ?? null, kind: "campaign",
      skipRecord: input.isTest === true,
      meta: res.ok ? {} : { error: (body as { message?: string }).message ?? `Resend said ${res.status}.` },
    });
    if (!res.ok) return { ok: false, error: (body as { message?: string }).message || `Resend said ${res.status}.` };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The mail service is unreachable." };
  }
}

/**
 * Where this customer's buttons should go.
 *
 * {{estimate}}: their newest SENT estimate's share link — /e/[token] gates on
 * sent_at, so linking an unsent one would show "not active". Nothing sent
 * falls back to the account page.
 */
export async function resolveRecipientLinks(
  db: SupabaseClient,
  accountId: string,
  baseUrl?: string,
): Promise<{ estimateUrl: string | null; accountUrl: string }> {
  const base = (baseUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://paintgroup.com.au").replace(/\/$/, "");
  const { data } = await db.from("estimates")
    .select("share_token, sent_at")
    .eq("account_id", accountId)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1);
  const token = data?.[0]?.share_token as string | undefined;
  return {
    estimateUrl: token ? `${base}/e/${token}` : null,
    accountUrl: `${base}/account`,
  };
}

function defaultBrand(): Brand {
  return {
    ink: "#12161A", text: "#333B42", muted: "#6B747C", line: "#E4E8EB",
    paper: "#FFFFFF", wash: "#F6F8F9", accent: "#2FB9CB", onAccent: "#FFFFFF",
    companyName: "Paint Group", logoUrl: null,
  };
}
