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

import { createHmac, timingSafeEqual } from "node:crypto";
import { renderEmail, renderPlainText, type Brand, type Template } from "./blocks";

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
  to: string;
  template: Template;
  brand?: Partial<Brand>;
  /** The account this is going to, so the unsubscribe link is theirs. */
  accountId: string;
  /** Prefixes the subject in a test so nobody mistakes it for the real thing. */
  isTest?: boolean;
  baseUrl?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * One email. Both parts, always — a marketing HTML email with no plain-text
 * alternative is a spam signal before anyone has even read it.
 */
export async function sendCampaignEmail(input: SendInput): Promise<SendResult> {
  const key = marketingKey();
  if (!key) return { ok: false, error: "No marketing email key is set on this server." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return { ok: false, error: "That isn't an email address." };

  const link = unsubscribeUrl(input.accountId, input.baseUrl);
  const html = renderEmail(input.template, { ...defaultBrand(), ...input.brand } as Brand)
    .replaceAll("{{unsubscribe}}", link);
  const text = renderPlainText(input.template, { ...defaultBrand(), ...input.brand } as Brand)
    .replaceAll("{{unsubscribe}}", link);

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
    if (!res.ok) return { ok: false, error: (body as { message?: string }).message || `Resend said ${res.status}.` };
    return { ok: true, id: String((body as { id?: string }).id ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The mail service is unreachable." };
  }
}

function defaultBrand(): Brand {
  return {
    ink: "#12161A", text: "#333B42", muted: "#6B747C", line: "#E4E8EB",
    paper: "#FFFFFF", wash: "#F6F8F9", accent: "#2FB9CB", onAccent: "#FFFFFF",
    companyName: "Paint Group", logoUrl: null,
  };
}
