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
import { renderHtmlToPdf } from "@/lib/invoicing/pdf";
import { readStandards } from "./read";
import { standardsPdfHtml } from "./pdfHtml";

/**
 * The four standards messages (brief §9, 1–4), each an automation in the
 * registry with editable wording, sent through the one dispatcher so the
 * office's Text / Email / Both choice and the record in `messages` apply.
 * SERVER ONLY — service client. Every send leaves a contractor_events row
 * with the dispatcher's outcome word, so "told" and "tried to tell" never
 * read the same (the Cavell lesson, 7 Oct).
 */

const STANDARDS_LINK = () => `${siteUrl()}/portal/standards/confirm`;

async function painterVars(service: SupabaseClient, contractorId: string) {
  const { messaging, company } = await loadMessaging(service);
  const c = await contactFor(service, contractorId);
  const companyName = company.name || "Paint Group";
  const { data: v, error: vErr } = await service.from("standards_versions").select("version_no").not("published_at", "is", null).eq("is_material", true).order("version_no", { ascending: false }).limit(1).maybeSingle();
  if (vErr) throw vErr; // no version, no message — the caller reports it
  const vars = { first_name: c.firstName, company_name: companyName, link: STANDARDS_LINK(), version: String((v as { version_no?: number } | null)?.version_no ?? "") };
  return { messaging, company, companyName, contact: c, vars };
}

const record = (service: SupabaseClient, contractorId: string, type: string, detail: Record<string, unknown>) =>
  service.from("contractor_events").insert({ contractor_id: contractorId, type, detail });

/** Message 1: the one-time invite the office sends an existing painter. */
export async function sendStandardsInvite(service: SupabaseClient, contractorId: string): Promise<string> {
  try {
    const { messaging, company, companyName, contact, vars } = await painterVars(service, contractorId);
    const out = await sendAutomation(service, {
      key: "contractor_standards_invite",
      to: { phone: contact.phone, email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      sms: { body: renderTemplate(messaging.standardsInviteSms, vars) },
      email: {
        subject: renderTemplate(messaging.standardsInviteEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.standardsInviteEmailIntro, vars), link: vars.link, buttonLabel: "Read and confirm the standards" }),
      },
      ctx: { kind: "standards_invite" }, contractorId,
    });
    const word = outcomeWord(out);
    await record(service, contractorId, "standards_invite_sent", { outcome: word, detail: "detail" in out ? out.detail : undefined });
    return word;
  } catch (e) {
    reportError(e, { where: "standards.notify.invite", extra: { contractorId } });
    return "error";
  }
}

/** Message 2: a reminder while unsigned (the ⚑17 ladder, or the PC's button). */
export async function sendStandardsReminder(service: SupabaseClient, contractorId: string, rung: string): Promise<string> {
  try {
    const { messaging, contact, vars } = await painterVars(service, contractorId);
    const out = await sendAutomation(service, {
      key: "contractor_standards_reminder",
      to: { phone: contact.phone },
      sms: { body: renderTemplate(messaging.standardsReminderSms, vars) },
      ctx: { kind: "standards_reminder" }, contractorId,
    });
    const word = outcomeWord(out);
    await record(service, contractorId, "standards_reminder_sent", { rung, outcome: word, detail: "detail" in out ? out.detail : undefined });
    return word;
  } catch (e) {
    reportError(e, { where: "standards.notify.reminder", extra: { contractorId } });
    return "error";
  }
}

/** Message 4: a material new version needs a fresh confirmation (⚑18). */
export async function sendStandardsNewVersion(service: SupabaseClient, contractorId: string): Promise<string> {
  try {
    const { messaging, company, companyName, contact, vars } = await painterVars(service, contractorId);
    const out = await sendAutomation(service, {
      key: "contractor_standards_new_version",
      to: { phone: contact.phone, email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      sms: { body: renderTemplate(messaging.standardsNewVersionSms, vars) },
      email: {
        subject: renderTemplate(messaging.standardsNewVersionEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.standardsNewVersionEmailIntro, vars), link: vars.link, buttonLabel: "Read what changed and confirm" }),
      },
      ctx: { kind: "standards_new_version" }, contractorId,
    });
    const word = outcomeWord(out);
    await record(service, contractorId, "standards_new_version_sent", { version: vars.version, outcome: word });
    return word;
  } catch (e) {
    reportError(e, { where: "standards.notify.newVersion", extra: { contractorId } });
    return "error";
  }
}

/**
 * Six ticks are in (ruling S8, message 3): render the PDF from the same data
 * the screens read, save it in the painter's documents (kind `standards`), and
 * email it to them attached. Idempotent per (painter, version): a second call
 * finds the document and sends nothing twice. Best-effort — the confirmation
 * itself is the six ack rows and the `standards_confirmed` event, already on
 * the record before this runs.
 */
export async function completeStandardsConfirmation(service: SupabaseClient, contractorId: string): Promise<"sent" | "exists" | "failed"> {
  try {
    const { standards, error } = await readStandards(service);
    if (!standards) throw new Error(error);
    const version = standards.version.no;
    const name = `Finish standards — Version ${version}`;
    const { data: existing, error: exErr } = await service.from("contractor_documents")
      .select("id").eq("contractor_id", contractorId).eq("kind", "standards").eq("name", name).limit(1);
    if (exErr) throw exErr;
    if ((existing ?? []).length > 0) return "exists";

    const { messaging, company, companyName, contact, vars } = await painterVars(service, contractorId);
    const { data: ev, error: evErr } = await service.from("contractor_events").select("created_at").eq("contractor_id", contractorId)
      .eq("type", "standards_confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (evErr) throw evErr;
    const confirmedAt = (ev as { created_at?: string } | null)?.created_at ?? new Date().toISOString();
    const confirmedOn = new Date(confirmedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
    const { data: who, error: whoErr } = await service.from("contractors").select("company_name, profiles(name)").eq("id", contractorId).maybeSingle();
    if (whoErr) throw whoErr;
    const w = who as unknown as { company_name: string | null; profiles: { name: string | null } | null } | null;
    const painterName = (w?.profiles?.name || w?.company_name || "Painter").trim();

    const pdf = await renderHtmlToPdf(standardsPdfHtml(standards, { painterName, confirmedOn, companyName }));
    const path = `${contractorId}/standards/finish-standards-v${version}.pdf`; // the 20260831 rule: the painter's own folder first
    const up = await service.storage.from("contractor-docs").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const ins = await service.from("contractor_documents").insert({
      contractor_id: contractorId, kind: "standards", name, file_url: path, status: "valid", verified_at: new Date().toISOString(), verify_note: "Generated at confirmation",
    });
    if (ins.error) throw ins.error;

    const out = await sendAutomation(service, {
      key: "contractor_standards_confirmed",
      to: { email: contact.email && !isTestEmail(contact.email) ? contact.email : null },
      email: {
        subject: renderTemplate(messaging.standardsConfirmedEmailSubject, vars),
        html: buildEstimateEmailHtml({ companyName, logoUrl: emailLogoUrl(company), intro: renderTemplate(messaging.standardsConfirmedEmailIntro, vars), link: `${siteUrl()}/portal/help/standards`, buttonLabel: "Open the standards" }),
        attachments: [{ filename: `finish-standards-v${version}.pdf`, content: pdf.toString("base64"), contentType: "application/pdf" }],
      },
      ctx: { kind: "standards_confirmed" }, contractorId,
    });
    await record(service, contractorId, "standards_pdf_sent", { version, path, outcome: outcomeWord(out) });
    return "sent";
  } catch (e) {
    reportError(e, { where: "standards.notify.confirmed", extra: { contractorId } });
    await record(service, contractorId, "standards_pdf_failed", { reason: e instanceof Error ? e.message : String(e) }).then(() => {}, () => {});
    return "failed";
  }
}
