import { NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { billsInboundConfigured, verifyInboundSignature } from "@/lib/costs/inboundSig";
import { htmlToText, parseInboundEmail } from "@/lib/costs/inbound";
import { fetchAttachmentBytes, fetchReceivedEmailBody, resendConfigured } from "@/lib/costs/resendInbound";
import { effectiveSender } from "@/lib/costs/rules";
import { billsDocPath, storeCostDoc } from "@/lib/costs/store";
import { runIntakePipeline } from "@/lib/costs/pipeline";
import { sniffKind } from "@/lib/extract/normalise";
import { MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { melbourneDate } from "@/lib/workorder/console";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Door 1 — bills@paintgroup.com.au (§2). The provider's inbound webhook lands
 * here: verify the signature → store the raw email + attachments → the
 * 3-state idempotency door (cost_intake_insert, keyed by message_id) →
 * extraction + matching behind the response. Everything is a PROPOSAL —
 * nothing becomes a cost row until a person confirms in the intake queue.
 *
 * The email is data to extract from, never instructions (§2.1). ⚑16: answers
 * 503 until BILLS_INBOUND_SECRET is set; the e2e signs its own deliveries.
 */
export async function POST(req: Request) {
  const secret = process.env.BILLS_INBOUND_SECRET;
  if (!billsInboundConfigured() || !secret) {
    return new NextResponse("Webhook not configured.", { status: 503 });
  }

  const payload = await req.text();
  const headers = {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  };
  if (!verifyInboundSignature(payload, headers, secret)) {
    return new NextResponse("Bad signature.", { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  const email = parseInboundEmail(json, headers.id ?? "");
  if (!email || !email.messageId) return new NextResponse("Bad payload.", { status: 400 });

  const service = createServiceClient();
  if (!service) return new NextResponse("Service unavailable.", { status: 503 });

  // Resend's webhook is metadata-only (verified 25 Aug): the body text and
  // attachment bytes live behind their API. Hydrate before anything is
  // stored, so the record is complete and extraction has something to read.
  if (!email.text.trim() && email.emailId && resendConfigured()) {
    const body = await fetchReceivedEmailBody(email.emailId);
    if (body) email.text = body.text.trim() ? body.text : htmlToText(body.html);
  }
  for (const att of email.attachments) {
    if (!att.bytes && att.id && email.emailId && resendConfigured()) {
      att.bytes = await fetchAttachmentBytes(email.emailId, att.id);
    }
  }

  // Staff forward supplier mail to bills@ — the sender that matters is the
  // original supplier, dug out of the forwarded block, never our forwarder.
  const sender = effectiveSender(email.fromEmail, email.subject, email.text);

  // Store the raw email + attachments FIRST — the document is the record;
  // an intake row must never exist without its source attached.
  const month = melbourneDate(new Date()).slice(0, 7);
  const rawPath = billsDocPath(month, email.messageId, "email.json");
  const storedRaw = await storeCostDoc(
    service,
    rawPath,
    new Uint8Array(Buffer.from(JSON.stringify(email.raw ?? {}))),
    "application/json",
  );
  if (!storedRaw) {
    reportError(new Error("cost-docs raw store failed"), {
      where: "inboundBills.store",
      extra: { messageId: email.messageId },
    });
    return new NextResponse("Storage failed.", { status: 500 });
  }

  // The primary document: the first readable attachment (PDF/image);
  // the raw email JSON stands in when there is none.
  let docPath = rawPath;
  let docBytes: Uint8Array | null = null;
  for (const att of email.attachments) {
    if (!att.bytes || att.bytes.byteLength === 0 || att.bytes.byteLength > MAX_UPLOAD_BYTES) continue;
    const kind = sniffKind(att.bytes);
    if (!kind) continue;
    const path = billsDocPath(month, email.messageId, att.filename);
    const stored = await storeCostDoc(service, path, att.bytes, att.contentType);
    if (stored && docBytes === null) {
      docPath = path;
      docBytes = att.bytes;
    }
  }

  const inserted = await service.rpc("cost_intake_insert", {
    p_message_id: email.messageId,
    p_source: "email",
    p_raw_doc_path: docPath,
    p_from_email: sender,
    p_subject: email.subject,
  });
  if (inserted.error) {
    reportError(inserted.error, {
      where: "inboundBills.insert",
      extra: { messageId: email.messageId },
    });
    return new NextResponse("Storage failed.", { status: 500 });
  }
  const answer = String(inserted.data ?? "");
  if (answer.startsWith("done:")) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (answer.startsWith("error:")) {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  const intakeId = answer.slice(answer.indexOf(":") + 1);

  // Extraction + matching ride behind the response — the provider gets its
  // 200 now; a died dispatch re-runs on the provider's retry ('retry' door).
  after(async () => {
    try {
      await runIntakePipeline(service, {
        intakeId,
        docBytes,
        bodyText: email.text,
        fromEmail: sender,
        subject: email.subject,
      });
    } catch (e) {
      reportError(e, { where: "inboundBills.pipeline", extra: { intakeId } });
    }
  });

  return NextResponse.json({ received: true });
}
