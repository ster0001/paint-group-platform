/**
 * Resend inbound content fetcher. SERVER ONLY (holds the API key).
 *
 * Resend's `email.received` webhook carries METADATA ONLY — no body text and
 * no attachment bytes (verified against the first live delivery, 25 Aug).
 * The content sits behind the API:
 *   GET /emails/receiving/{email_id}                          → text/html body
 *   GET /emails/receiving/{email_id}/attachments/{att_id}     → { download_url }
 * The download_url is a signed CDN link for the raw bytes.
 *
 * Everything here is best-effort: a fetch failure degrades to the metadata
 * we already stored — the intake row still exists and fails LOUDLY into the
 * queue rather than silently to $0.
 */

import { MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";

const API = "https://api.resend.com";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };
}

export async function fetchReceivedEmailBody(
  emailId: string,
): Promise<{ text: string; html: string } | null> {
  if (!resendConfigured() || !emailId) return null;
  try {
    const r = await fetch(`${API}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: headers(),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { text?: string | null; html?: string | null };
    return { text: j.text ?? "", html: j.html ?? "" };
  } catch {
    return null;
  }
}

export async function fetchAttachmentBytes(
  emailId: string,
  attachmentId: string,
): Promise<Uint8Array | null> {
  if (!resendConfigured() || !emailId || !attachmentId) return null;
  try {
    const meta = await fetch(
      `${API}/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: headers() },
    );
    if (!meta.ok) return null;
    const j = (await meta.json()) as { download_url?: string; size?: number };
    if (!j.download_url) return null;
    if (typeof j.size === "number" && j.size > MAX_UPLOAD_BYTES) return null;
    const file = await fetch(j.download_url);
    if (!file.ok) return null;
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
