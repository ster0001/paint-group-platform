import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactFor } from "@/lib/contractor/notify";
import { outcomeWord, sendAutomation } from "@/lib/automations/dispatch";
import { renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildEstimateEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isTestEmail } from "@/lib/accounts/identity";
import { renderHtmlToPdf, siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { readInduction } from "./read";
import { inductionPdfHtml } from "./pdfHtml";
import { isLanguageCode, type LanguageCode } from "./languages";
import { parseInductionStatus } from "./status";

/**
 * The induction messages (brief §5; inventory 16f–16h), each an automation in
 * the registry with editable wording, through the one dispatcher. SERVER ONLY,
 * service client. Every send leaves a contractor_events row with the
 * dispatcher's outcome word.
 */

const record = (service: SupabaseClient, contractorId: string, type: string, detail: Record<string, unknown>) =>
  service.from("contractor_events").insert({ contractor_id: contractorId, type, detail });

const INDUCTION_LINK = () => `${siteUrl()}/portal/induction`;

/** Who this login is: a contractor (their row) or a worker (their contractor_users row). */
async function whoIs(service: SupabaseClient, profileId: string): Promise<
  | { kind: "contractor"; contractorId: string; name: string; language: LanguageCode }
  | { kind: "worker"; contractorId: string; contractorUserId: string; name: string; mobile: string; language: LanguageCode }
  | null> {
  const { data: c, error: cErr } = await service.from("contractors").select("id, company_name, induction_language, profiles(name)").eq("profile_id", profileId).maybeSingle();
  if (cErr) throw cErr;
  const cr = c as unknown as { id: string; company_name: string | null; induction_language: string | null; profiles: { name: string | null } | null } | null;
  if (cr) return { kind: "contractor", contractorId: cr.id, name: (cr.profiles?.name || cr.company_name || "Painter").trim(), language: isLanguageCode(cr.induction_language) ? cr.induction_language : "en" };
  const { data: w, error: wErr } = await service.from("contractor_users").select("id, contractor_id, name, mobile, induction_language").eq("profile_id", profileId).eq("role", "worker").is("removed_at", null).maybeSingle();
  if (wErr) throw wErr;
  const wr = w as { id: string; contractor_id: string; name: string; mobile: string; induction_language: string | null } | null;
  if (wr) return { kind: "worker", contractorId: wr.contractor_id, contractorUserId: wr.id, name: wr.name || "Worker", mobile: wr.mobile, language: isLanguageCode(wr.induction_language) ? wr.induction_language : "en" };
  return null;
}

/**
 * The last tick is in: render the PDF from the same rows the screens read, in
 * the painter's language, save it in the contractor's documents (kind
 * `induction`) and send it — email with the PDF attached to a contractor, a
 * text to a worker (no email). Idempotent per (login, version): a second call
 * finds the document and sends nothing twice. Best-effort — the completion
 * itself is the ack rows and the `induction_completed` event, already on the
 * record before this runs.
 */
export async function completeInduction(service: SupabaseClient, profileId: string): Promise<"sent" | "exists" | "failed"> {
  let contractorId: string | null = null;
  try {
    const who = await whoIs(service, profileId);
    if (!who) throw new Error("not a painter login");
    contractorId = who.contractorId;
    const { data: st, error: stErr } = await service.rpc("induction_status", { p_profile_id: profileId });
    if (stErr) throw stErr;
    const status = parseInductionStatus(st);
    if (!status?.complete) return "failed";
    const version = status.versionNo ?? 1;
    const name = who.kind === "worker" ? `Worker induction — ${who.name} — Version ${version}` : `Induction — Version ${version}`;
    const { data: existing, error: exErr } = await service.from("contractor_documents").select("id").eq("contractor_id", who.contractorId).eq("kind", "induction").eq("name", name).limit(1);
    if (exErr) throw exErr;
    if ((existing ?? []).length > 0) return "exists";

    const { induction, error } = await readInduction(service, who.language);
    if (!induction) throw new Error(error);
    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    const completedOn = new Date(status.completedAt ?? new Date().toISOString()).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
    const checkLine = status.kind === "refresher" ? null : status.checkPassed ? "The practical check was passed." : "The practical check is recorded separately by the facilitator.";
    const pdf = await renderHtmlToPdf(inductionPdfHtml(induction, status.kind, { painterName: who.name, completedOn, companyName, checkLine }));
    const path = who.kind === "worker"
      ? `${who.contractorId}/induction/worker-${who.contractorUserId}-v${version}.pdf`
      : `${who.contractorId}/induction/induction-v${version}.pdf`;
    const up = await service.storage.from("contractor-docs").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const ins = await service.from("contractor_documents").insert({
      contractor_id: who.contractorId, kind: "induction", name, file_url: path, status: "valid", verified_at: new Date().toISOString(), verify_note: "Generated at completion",
    });
    if (ins.error) throw ins.error;

    const contact = await contactFor(service, who.contractorId);
    const vars = { first_name: who.kind === "worker" ? (who.name.split(" ")[0] || "there") : contact.firstName, company_name: companyName, link: INDUCTION_LINK(), version: String(version) };
    if (who.kind === "worker") {
      const out = await sendAutomation(service, {
        key: "contractor_worker_induction_complete",
        to: { phone: who.mobile || null },
        sms: { body: renderTemplate(messaging.workerInductionCompleteSms, vars) },
        ctx: { kind: "induction_complete" }, contractorId: who.contractorId,
      });
      await record(service, who.contractorId, "induction_pdf_sent", { version, path, profile_id: profileId, contractor_user_id: who.contractorUserId, outcome: outcomeWord(out) });
      return "sent";
    }
    const out = await sendAutomation(service, {
      key: "contractor_induction_complete",
      to: { email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      email: {
        subject: renderTemplate(messaging.inductionCompleteEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.inductionCompleteEmailIntro, vars), link: vars.link, buttonLabel: "Open the induction" }),
        attachments: [{ filename: `induction-v${version}.pdf`, content: pdf.toString("base64"), contentType: "application/pdf" }],
      },
      ctx: { kind: "induction_complete" }, contractorId: who.contractorId,
    });
    await record(service, who.contractorId, "induction_pdf_sent", { version, path, profile_id: profileId, outcome: outcomeWord(out) });
    return "sent";
  } catch (e) {
    reportError(e, { where: "induction.notify.complete", extra: { profileId } });
    if (contractorId) await record(service, contractorId, "induction_pdf_failed", { profile_id: profileId, reason: e instanceof Error ? e.message : String(e) }).then(() => {}, () => {});
    return "failed";
  }
}

/** The office invites an existing painter to the refresher (one text + email, the grace period starts in the RPC). */
export async function sendInductionInvite(service: SupabaseClient, contractorId: string): Promise<string> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    const contact = await contactFor(service, contractorId);
    const vars = { first_name: contact.firstName, company_name: companyName, link: INDUCTION_LINK(), version: "" };
    const out = await sendAutomation(service, {
      key: "contractor_induction_invite",
      to: { phone: contact.phone, email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      sms: { body: renderTemplate(messaging.inductionInviteSms, vars) },
      email: {
        subject: renderTemplate(messaging.inductionInviteEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.inductionInviteEmailIntro, vars), link: vars.link, buttonLabel: "Open the refresher" }),
      },
      ctx: { kind: "induction_invite" }, contractorId,
    });
    const word = outcomeWord(out);
    await record(service, contractorId, "induction_invite_sent", { outcome: word, detail: "detail" in out ? out.detail : undefined });
    return word;
  } catch (e) {
    reportError(e, { where: "induction.notify.invite", extra: { contractorId } });
    return "error";
  }
}
