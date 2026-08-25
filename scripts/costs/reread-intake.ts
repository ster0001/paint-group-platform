/**
 * Re-read undecided email intake rows — `npx tsx scripts/costs/reread-intake.ts`
 *
 * For each pending cost_intake email row: re-parse the stored raw delivery,
 * hydrate body + attachment bytes from Resend's API (the webhook payload is
 * metadata-only), store the real document, and run extraction + matching
 * again. Decided rows are never touched (the RPC refuses them). Idempotent —
 * safe to run whenever a delivery got stuck.
 *
 * Uses .env.local (production) unless the env is already set — the same
 * degrade-to-nothing rules as the webhook apply.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local first — the lib modules read process.env at call time.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.trimStart().startsWith("#")) continue;
    const k = line.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = line.slice(eq + 1).trim();
  }
} catch {
  // fine — rely on the ambient env
}

async function main() {
  const { parseInboundEmail, htmlToText } = await import("../../lib/costs/inbound");
  const { fetchAttachmentBytes, fetchReceivedEmailBody, resendConfigured } = await import(
    "../../lib/costs/resendInbound"
  );
  const { effectiveSender } = await import("../../lib/costs/rules");
  const { billsDocPath, storeCostDoc, COST_DOCS_BUCKET } = await import("../../lib/costs/store");
  const { runIntakePipeline } = await import("../../lib/costs/pipeline");
  const { sniffKind } = await import("../../lib/extract/normalise");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const service = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await service
    .from("cost_intake")
    .select("id, message_id, raw_doc_path, created_at, extract_status, status, confirmed_at")
    .eq("source", "email")
    .eq("status", "pending")
    .is("confirmed_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  if (!rows?.length) {
    console.log("Nothing pending — queue is clean.");
    return;
  }
  console.log(`${rows.length} pending email document(s). Resend API: ${resendConfigured() ? "configured" : "NOT configured (metadata only)"}`);

  for (const row of rows) {
    const label = `${row.id.slice(0, 8)} ${row.message_id ?? ""}`;
    try {
      // The raw delivery is the record — start from it.
      const rawPath = row.raw_doc_path?.endsWith("email.json")
        ? row.raw_doc_path
        : row.raw_doc_path?.replace(/\/[^/]*$/, "/email.json");
      if (!rawPath) {
        console.log(`· ${label}: no raw delivery stored — skipped`);
        continue;
      }
      const { data: blob } = await service.storage.from(COST_DOCS_BUCKET).download(rawPath);
      if (!blob) {
        console.log(`· ${label}: raw delivery missing from storage — skipped`);
        continue;
      }
      const email = parseInboundEmail(JSON.parse(await blob.text()), row.message_id ?? "");
      if (!email) {
        console.log(`· ${label}: raw delivery unparseable — skipped`);
        continue;
      }

      if (!email.text.trim() && email.emailId) {
        const body = await fetchReceivedEmailBody(email.emailId);
        if (body) {
          email.text = body.text.trim() ? body.text : htmlToText(body.html);
          email.html = body.html;
        }
      }

      const month = new Date(row.created_at).toISOString().slice(0, 7);
      if (!email.attachments.some((a) => a.bytes || a.id) && (email.html || email.text)) {
        const { candidateDocLinks } = await import("../../lib/costs/links");
        const { fetchLinkedDoc } = await import("../../lib/costs/fetchDoc");
        const linked = await fetchLinkedDoc(candidateDocLinks(email.html, email.text));
        if (linked) {
          email.attachments.push({
            filename: linked.filename, contentType: linked.contentType,
            bytes: linked.bytes, id: null,
          });
        }
      }
      let docPath = rawPath;
      let docBytes: Uint8Array | null = null;
      for (const att of email.attachments) {
        if (!att.bytes && att.id && email.emailId) {
          att.bytes = await fetchAttachmentBytes(email.emailId, att.id);
        }
        if (!att.bytes || !sniffKind(att.bytes)) continue;
        const path = billsDocPath(month, email.messageId, att.filename);
        const stored = await storeCostDoc(service, path, att.bytes, att.contentType);
        if (stored && docBytes === null) {
          docPath = path;
          docBytes = att.bytes;
        }
      }

      const sender = effectiveSender(email.fromEmail, email.subject, email.text);
      await service
        .from("cost_intake")
        .update({ raw_doc_path: docPath, from_email: sender })
        .eq("id", row.id);

      const result = await runIntakePipeline(service, {
        intakeId: row.id,
        docBytes,
        bodyText: email.text,
        fromEmail: sender,
        subject: email.subject,
      });
      console.log(`· ${label}: sender=${sender} doc=${docBytes ? "attachment" : "email-only"} → ${result.result}`);
    } catch (e) {
      console.log(`· ${label}: FAILED — ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
