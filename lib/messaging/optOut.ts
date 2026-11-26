/**
 * Every MARKETING message carries its own way out (Tom, 26 Nov 2026: "when we
 * turn on the automations, do they have an opt out?"). Campaigns always did —
 * lib/campaigns/sms.ts and the email renderer add them — but the marketing
 * automations (the lead and estimate chasers, the abandoned-wizard email, the
 * anniversaries, the quarterly nurture, the review request) were only BLOCKED
 * for people who had opted out; the messages themselves never said how. The
 * send layer (lib/messaging/send.ts) now adds it to any send tagged
 * `ctx.marketing`, so a new marketing automation cannot forget. Pure.
 */
export const SMS_OPT_OUT = "Reply STOP to opt out";

/** The text with "Reply STOP to opt out" on the end — unless the writer already said STOP in their own words. */
export function withSmsOptOut(body: string): string {
  if (/\bSTOP\b/.test(body)) return body;
  const b = body.trimEnd();
  return `${b}${/[.!?)]$/.test(b) ? "" : "."} ${SMS_OPT_OUT}`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The email with an unsubscribe line at the foot (inside the body when there is one). Idempotent on the link. */
export function withEmailUnsubscribe(html: string, url: string): string {
  if (html.includes(url)) return html;
  const line = `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a8a8a;font-family:Arial,Helvetica,sans-serif">Don't want these emails? <a href="${escapeAttr(url)}" style="color:#8a8a8a;text-decoration:underline">Unsubscribe</a>.</p>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at >= 0 ? `${html.slice(0, at)}${line}${html.slice(at)}` : `${html}${line}`;
}

/** The headers mail clients read for their own one-click unsubscribe button. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
