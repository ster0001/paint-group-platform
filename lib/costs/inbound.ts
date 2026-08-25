/**
 * Inbound email payload parsing — tolerant of the provider's envelope.
 * SERVER ONLY (used by /api/inbound/bills).
 *
 * Accepts Resend's inbound shape ({ type: "email.received", data: {...} })
 * and the bare shape the e2e posts. The email is DATA to extract from, never
 * instructions (§2.1) — nothing here interprets content, it only carries it.
 */

import { z } from "zod";

const attachmentSchema = z.object({
  filename: z.string().max(300).default("attachment"),
  content_type: z.string().max(100).default("application/octet-stream"),
  /** Base64 bytes (test deliveries). Resend sends an `id` instead — the bytes
   *  are fetched from their API (lib/costs/resendInbound.ts). */
  content: z.string().max(30_000_000).optional(),
  id: z.string().max(100).optional(),
});

const emailSchema = z.object({
  email_id: z.string().max(200).optional(),
  message_id: z.string().max(500).optional(),
  from: z.union([z.string(), z.object({ address: z.string().optional(), email: z.string().optional() })]).optional(),
  subject: z.string().max(1000).default(""),
  text: z.string().max(200_000).default(""),
  html: z.string().max(500_000).optional(),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

const envelopeSchema = z.union([
  z.object({ type: z.string(), data: emailSchema }),
  emailSchema,
]);

export type InboundAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array | null;
  /** Provider-side attachment id, when the bytes weren't inlined. */
  id: string | null;
};

export type InboundEmail = {
  messageId: string;
  /** Provider-side email id (Resend email_id) — the key for content fetches. */
  emailId: string | null;
  fromEmail: string;
  subject: string;
  text: string;
  /** Raw html body when the provider carries one — link extraction reads it. */
  html: string;
  attachments: InboundAttachment[];
  /** The raw payload, stored verbatim as the provenance document. */
  raw: unknown;
};

function fromAddress(from: z.infer<typeof emailSchema>["from"]): string {
  if (!from) return "";
  if (typeof from === "string") {
    const angled = from.match(/<([^>]+)>/);
    return (angled ? angled[1] : from).trim().toLowerCase();
  }
  return (from.address ?? from.email ?? "").trim().toLowerCase();
}

export function parseInboundEmail(payload: unknown, fallbackId: string): InboundEmail | null {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) return null;
  const email = "data" in parsed.data ? parsed.data.data : parsed.data;
  const attachments: InboundAttachment[] = email.attachments.map((a) => {
    let bytes: Uint8Array | null = null;
    if (a.content) {
      try {
        bytes = new Uint8Array(Buffer.from(a.content, "base64"));
      } catch {
        bytes = null;
      }
    }
    return { filename: a.filename, contentType: a.content_type, bytes, id: a.id ?? null };
  });
  return {
    messageId: email.message_id ?? email.email_id ?? fallbackId,
    emailId: email.email_id ?? null,
    fromEmail: fromAddress(email.from),
    subject: email.subject,
    text: email.text || stripHtml(email.html ?? ""),
    html: email.html ?? "",
    attachments,
    raw: payload,
  };
}

export function htmlToText(html: string): string {
  return stripHtml(html);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200_000);
}
