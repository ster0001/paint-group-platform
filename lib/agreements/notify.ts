import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactFor } from "@/lib/contractor/notify";
import { outcomeWord, sendAutomation } from "@/lib/automations/dispatch";
import { renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildEstimateEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { ensureAgreementPdf } from "./pdf";
import { dmy } from "./status";

/**
 * The agreement messages (brief §2, §3, §7), each an automation in the
 * registry with editable wording, through the one dispatcher. SERVER ONLY,
 * service client. Every send leaves a contractor_events row with the
 * dispatcher's outcome word.
 */

const record = (service: SupabaseClient, contractorId: string, type: string, detail: Record<string, unknown>) =>
  service.from("contractor_events").insert({ contractor_id: contractorId, type, detail });

const AGREEMENT_LINK = () => `${siteUrl()}/portal/agreement`;

/**
 * The contractor has signed: render the PDF once, email it to them with the
 * copy attached, and email the office its copy. Idempotent per agreement —
 * the `agreement_pdf_sent` event is the guard, so a retry after a failed
 * render sends once. Best-effort: the signature itself is the row, already
 * on the record before this runs.
 */
export async function sendAgreementSigned(service: SupabaseClient, agreementId: string): Promise<"sent" | "exists" | "failed"> {
  let contractorId: string | null = null;
  try {
    const { data: row, error: rowErr } = await service.from("contractor_agreements").select("id, contractor_id, version, signed_name, signed_at, expires_on").eq("id", agreementId).maybeSingle();
    if (rowErr) throw rowErr;
    const a = row as { id: string; contractor_id: string; version: number | null; signed_name: string; signed_at: string; expires_on: string | null } | null;
    if (!a) throw new Error("agreement not found");
    contractorId = a.contractor_id;
    const { data: sent, error: sentErr } = await service.from("contractor_events").select("id").eq("contractor_id", a.contractor_id).eq("type", "agreement_pdf_sent").contains("detail", { agreement_id: a.id }).limit(1);
    if (sentErr) throw sentErr;
    if ((sent ?? []).length > 0) return "exists";

    const pdf = await ensureAgreementPdf(service, a.id);
    if (!pdf.path) throw new Error(pdf.error ?? "pdf not rendered");
    const { data: file, error: dlErr } = await service.storage.from("contractor-docs").download(pdf.path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "pdf download failed");
    const content = Buffer.from(await file.arrayBuffer()).toString("base64");
    const filename = `subcontractor-agreement-v${a.version ?? 1}.pdf`;

    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    const contact = await contactFor(service, a.contractor_id);
    const vars = { first_name: contact.firstName, company_name: companyName, link: AGREEMENT_LINK(), version: String(a.version ?? 1), expires_on: a.expires_on ? dmy(a.expires_on) : "", painter: a.signed_name };

    const out = await sendAutomation(service, {
      key: "contractor_agreement_signed",
      to: { email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      email: {
        subject: renderTemplate(messaging.agreementSignedEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.agreementSignedEmailIntro, vars), link: vars.link, buttonLabel: "Open your agreement" }),
        attachments: [{ filename, content, contentType: "application/pdf" }],
      },
      ctx: { kind: "agreement_signed" }, contractorId: a.contractor_id,
    });
    const officeOut = await sendAutomation(service, {
      key: "office_agreement_signed",
      to: { email: messaging.officeEmail || null },
      email: {
        subject: renderTemplate(messaging.officeAgreementSignedSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.officeAgreementSignedBody, vars), link: `${siteUrl()}/contractors`, buttonLabel: "Open Contractors" }),
        attachments: [{ filename, content, contentType: "application/pdf" }],
      },
      ctx: { kind: "office_alert" }, contractorId: a.contractor_id,
    });
    await record(service, a.contractor_id, "agreement_pdf_sent", { agreement_id: a.id, version: a.version, path: pdf.path, company_signature: pdf.companySignature, outcome: outcomeWord(out), office_outcome: outcomeWord(officeOut) });
    return "sent";
  } catch (e) {
    reportError(e, { where: "agreements.notify.signed", extra: { agreementId } });
    if (contractorId) await record(contractorId ? service : service, contractorId, "agreement_pdf_failed", { agreement_id: agreementId, reason: e instanceof Error ? e.message : String(e) }).then(() => {}, () => {});
    return "failed";
  }
}

/** The office asks a contractor to sign (brief §3: Request signature) — one text + email with the portal link. The grace window started in the RPC. */
export async function sendAgreementRequest(service: SupabaseClient, contractorId: string): Promise<string> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    const contact = await contactFor(service, contractorId);
    const vars = { first_name: contact.firstName, company_name: companyName, link: AGREEMENT_LINK() };
    const out = await sendAutomation(service, {
      key: "contractor_agreement_request",
      to: { phone: contact.phone, email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      sms: { body: renderTemplate(messaging.agreementRequestSms, vars) },
      email: {
        subject: renderTemplate(messaging.agreementRequestEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.agreementRequestEmailIntro, vars), link: vars.link, buttonLabel: "Read and sign" }),
      },
      ctx: { kind: "agreement_request" }, contractorId,
    });
    const word = outcomeWord(out);
    await record(service, contractorId, "agreement_request_sent", { outcome: word, detail: "detail" in out ? out.detail : undefined });
    return word;
  } catch (e) {
    reportError(e, { where: "agreements.notify.request", extra: { contractorId } });
    return "error";
  }
}
