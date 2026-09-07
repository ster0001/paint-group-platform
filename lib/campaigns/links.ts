/**
 * Tracked links (P5, deep dive §4.3.6) — the writer for `cta_clicked`.
 *
 * Every http(s) link in a campaign email is rewritten to /t/<token>, and the
 * redirect route records the click against the queue row before sending the
 * person on. Stateless: the token is the message id, the destination and an
 * HMAC over both — no table, nothing to leak in a backup, and no way to forge
 * a click for a message you don't hold.
 *
 * The unsubscribe link is never tracked (a tracked unsubscribe is a dark
 * pattern), and neither are mailto: / tel:.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.MARKETING_UNSUBSCRIBE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "development-only-unsubscribe-secret";
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (messageId: string, encodedUrl: string) =>
  createHmac("sha256", secret()).update(`${messageId}.${encodedUrl}`).digest("base64url").slice(0, 22);

export function trackedToken(messageId: string, url: string): string {
  const enc = b64(url);
  return `${messageId}.${enc}.${mac(messageId, enc)}`;
}

export function trackedUrl(base: string, messageId: string, url: string): string {
  return `${base.replace(/\/$/, "")}/t/${trackedToken(messageId, url)}`;
}

/** Null when forged, malformed, or not a web address. */
export function parseTracked(token: string): { messageId: string; url: string } | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [messageId, enc, sig] = parts;
  if (!/^[0-9a-f-]{36}$/.test(messageId) || !enc || !sig) return null;
  const expected = mac(messageId, enc);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let url: string;
  try { url = Buffer.from(enc, "base64url").toString("utf8"); } catch { return null; }
  if (!/^https?:\/\//i.test(url)) return null;
  return { messageId, url };
}

/** Rewrite every trackable href in rendered HTML. Idempotent: an already-tracked link is left alone. */
export function trackLinks(html: string, base: string, messageId: string): string {
  const prefix = `${base.replace(/\/$/, "")}/t/`;
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (whole, url: string) => {
    if (url.startsWith(prefix)) return whole;
    if (/\/u\/[^/]+$/.test(url)) return whole;      // the unsubscribe link
    return `href="${trackedUrl(base, messageId, url)}"`;
  });
}
