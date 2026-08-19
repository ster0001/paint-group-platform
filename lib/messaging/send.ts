/**
 * Outbound delivery for estimates — email via Resend, SMS via Twilio.
 * SERVER ONLY — reads env secrets; import from server actions, never client code.
 *
 * Both are plain REST calls so there are no extra dependencies. Configuration
 * is entirely env-driven; when a channel isn't configured the caller gets a
 * clear "not configured" result instead of a thrown error, and the estimate
 * send itself still succeeds — delivery is best-effort on top of the guarded
 * status transition, never a gate on it.
 *
 * Env:
 *   RESEND_API_KEY      — Resend API key (email)
 *   EMAIL_FROM          — e.g. `Paint Group <email@paintgroup.com.au>` (domain must be verified in Resend)
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM — SMS sender (number in E.164, or alphanumeric ID)
 */

export type DeliveryResult =
  | { status: "sent"; id?: string }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

const DEFAULT_FROM = "Paint Group <email@paintgroup.com.au>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<DeliveryResult> {
  if (!emailConfigured()) return { status: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { status: "error", message: body?.message ?? `Email service returned ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { status: "sent", id: body?.id };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Email send failed" };
  }
}

export async function sendSms(opts: { to: string; body: string }): Promise<DeliveryResult> {
  if (!smsConfigured()) return { status: "not_configured" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: process.env.TWILIO_FROM!,
        To: opts.to,
        Body: opts.body,
      }).toString(),
    });
    const body = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
    if (!res.ok) return { status: "error", message: body?.message ?? `SMS service returned ${res.status}` };
    return { status: "sent", id: body?.sid };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "SMS send failed" };
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The estimate email — table-based with inline styles so it renders the same
 * in Gmail/Outlook/Apple Mail. One prominent "Open your estimate" button.
 */
export function buildEstimateEmailHtml(opts: {
  intro: string;
  link: string;
  companyName: string;
  logoUrl?: string;
  estimatorName?: string;
  estimatorTitle?: string;
  estimatorPhone?: string;
  companyPhone?: string;
}): string {
  const introHtml = opts.intro
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const logo = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="${esc(opts.companyName)}" height="44" style="height:44px;max-width:220px;object-fit:contain;" />`
    : `<span style="font-size:20px;font-weight:700;color:#111827;">${esc(opts.companyName)}</span>`;
  const signoff = opts.estimatorName
    ? `<p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#1f2937;">
         ${esc(opts.estimatorName)}${opts.estimatorTitle ? `<br/><span style="color:#6b7280;">${esc(opts.estimatorTitle)}, ${esc(opts.companyName)}</span>` : ""}
         ${opts.estimatorPhone ? `<br/><span style="color:#6b7280;">${esc(opts.estimatorPhone)}</span>` : ""}
       </p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #e5e7eb;">${logo}</td></tr>
      <tr><td style="padding:28px 32px 8px;">
        ${introHtml}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
          <tr><td style="border-radius:8px;background:#059669;">
            <a href="${esc(opts.link)}" target="_blank"
               style="display:inline-block;padding:13px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
              Open your estimate
            </a>
          </td></tr>
        </table>
        <p style="margin:8px 0 16px;font-size:12px;color:#6b7280;">
          Or copy this link into your browser:<br/>
          <a href="${esc(opts.link)}" style="color:#059669;word-break:break-all;">${esc(opts.link)}</a>
        </p>
        ${signoff}
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">
          ${esc(opts.companyName)}${opts.companyPhone ? ` · ${esc(opts.companyPhone)}` : ""}
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** The email for a new chat message from staff: shows the message and a
 * Respond button that deep-links straight to the estimate's chat box. */
export function buildChatEmailHtml(opts: {
  message: string;
  link: string;          // already ends with #chat
  companyName: string;
  logoUrl?: string;
  estimatorName?: string;
  companyPhone?: string;
}): string {
  const logo = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="${esc(opts.companyName)}" height="40" style="height:40px;max-width:200px;object-fit:contain;" />`
    : `<span style="font-size:19px;font-weight:700;color:#111827;">${esc(opts.companyName)}</span>`;
  const bodyHtml = esc(opts.message).replace(/\n/g, "<br/>");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 32px 16px;border-bottom:1px solid #e5e7eb;">${logo}</td></tr>
      <tr><td style="padding:24px 32px 8px;">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">New message about your estimate${opts.estimatorName ? ` from ${esc(opts.estimatorName)}` : ""}:</p>
        <div style="margin:0 0 20px;padding:14px 16px;background:#f9fafb;border-left:3px solid #059669;border-radius:0 8px 8px 0;font-size:15px;line-height:1.6;color:#1f2937;">${bodyHtml}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
          <tr><td style="border-radius:8px;background:#059669;">
            <a href="${esc(opts.link)}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Respond</a>
          </td></tr>
        </table>
        <p style="margin:8px 0 8px;font-size:12px;color:#6b7280;">Or open: <a href="${esc(opts.link)}" style="color:#059669;word-break:break-all;">${esc(opts.link)}</a></p>
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">${esc(opts.companyName)}${opts.companyPhone ? ` · ${esc(opts.companyPhone)}` : ""}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
