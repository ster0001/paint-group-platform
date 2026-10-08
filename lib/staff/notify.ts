/**
 * Staff alerts (Tom, 10 Sep 2026) — the server half. SERVICE CLIENT ONLY.
 *
 * "Contract accepted, job approved, job declined, invoice paid, variation
 * requested, contractor invoice made — which staff member sees each of
 * these." Every one is an automation with the usual switch (registry key =
 * event key); WHO is told, and how, is each person's own profiles.staff_notify
 * (lib/staff/notifyEvents.ts). Every send goes through lib/messaging/send so
 * it is recorded in `messages` like everything else.
 *
 * Once-only: a staff_notifications row is claimed per (event, entity) BEFORE
 * anything is sent, so a hook that fires twice — the painter's browser
 * pinging after a refresh, Stripe redelivering a webhook — tells nobody
 * twice. Best-effort throughout: an alert never unwinds the thing it
 * announces, so every entry point swallows and reports.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildEstimateEmailHtml, emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { parseStaffNotify, wantsChannel, type StaffEventKey, type StaffNotifyChannel } from "./notifyEvents";
import { emailLogoUrl } from "@/lib/messaging/logo";

export type StaffAlert = {
  key: StaffEventKey;
  /** What the guard row is keyed on — the offer, the payment, the variation… */
  entityId: string;
  subject: string;
  /** Plain text; blank lines separate paragraphs. The link is added as the button / last line. */
  message: string;
  link: string;
  /** Addresses already told by another path (the office address on the accepted email). */
  skipEmails?: string[];
  /** Session 1: editable wording. When set, subject/message above are only the fallback. */
  templates?: { subject: keyof MessagingSettings; body: keyof MessagingSettings };
  vars?: Record<string, string>;
  /** Tom, 20 Sep: the estimate this alert is about. Recorded on the send, so an email REPLY to it can be routed back into that estimate's chat (app/api/inbound/messages). */
  estimateId?: string | null;
};

export type StaffAlertOutcome = "sent" | "off" | "already" | "nobody" | "error";

type StaffProfile = { id: string; name: string | null; phone: string | null; staff_notify: unknown };
type Recipient = { profileId: string; channel: StaffNotifyChannel; to: string };

/** Pure: who gets this event by which channel, given the staff list. Exported for the test. */
export function recipientsFor(
  staff: Array<StaffProfile & { email: string | null }>,
  key: StaffEventKey,
  skipEmails: string[] = [],
): Recipient[] {
  const skip = new Set(skipEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const out: Recipient[] = [];
  for (const p of staff) {
    const map = parseStaffNotify(p.staff_notify);
    if (wantsChannel(map, key, "email") && p.email && !skip.has(p.email.trim().toLowerCase())) {
      out.push({ profileId: p.id, channel: "email", to: p.email.trim() });
    }
    if (wantsChannel(map, key, "sms") && p.phone) {
      const phone = normalisePhoneAU(p.phone);
      if (phone) out.push({ profileId: p.id, channel: "sms", to: phone });
    }
  }
  return out;
}

/**
 * The staff logins, with the sign-in email of everyone who takes `key` by
 * email — the input recipientsFor() reads. Throws when the list cannot be
 * read: "nobody is ticked" and "we could not look" must never look alike.
 */
export async function loadStaffForEvent(
  service: SupabaseClient,
  key: StaffEventKey,
): Promise<Array<StaffProfile & { email: string | null }>> {
  const { data: rows, error } = await service.from("profiles").select("id, name, phone, staff_notify").eq("role", "staff");
  if (error) throw new Error(`staff list: ${error.message}`);
  return Promise.all(((rows ?? []) as StaffProfile[]).map(async (p) => {
    if (!wantsChannel(parseStaffNotify(p.staff_notify), key, "email")) return { ...p, email: null };
    const { data: u } = await service.auth.admin.getUserById(p.id);
    return { ...p, email: u?.user?.email ?? null };
  }));
}

export async function notifyStaff(service: SupabaseClient, alert: StaffAlert): Promise<StaffAlertOutcome> {
  try {
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, alert.key)) return "off";
    if (alert.templates && alert.vars) {
      const subj = String(messaging[alert.templates.subject] ?? "").trim();
      const body = String(messaging[alert.templates.body] ?? "").trim();
      if (subj) alert = { ...alert, subject: renderTemplate(subj, { ...alert.vars, link: alert.link }) };
      if (body) alert = { ...alert, message: renderTemplate(body, { ...alert.vars, link: alert.link }) };
    }

    // Claim the guard first — a duplicate claim is the signal to stop.
    const claim = await service
      .from("staff_notifications")
      .upsert({ event_key: alert.key, entity_id: alert.entityId }, { onConflict: "event_key,entity_id", ignoreDuplicates: true })
      .select("id");
    if (claim.error) throw claim.error;
    const claimId = (claim.data as { id: string }[] | null)?.[0]?.id;
    if (!claimId) return "already";

    const recipients = recipientsFor(await loadStaffForEvent(service, alert.key), alert.key, alert.skipEmails);
    if (recipients.length === 0) {
      await service.from("staff_notifications").update({ recipients: [] }).eq("id", claimId);
      return "nobody";
    }

    const companyName = company.name || "Paint Group";
    const html = buildEstimateEmailHtml({
      intro: alert.message, link: alert.link, companyName,
      logoUrl: emailLogoUrl(company), buttonLabel: "Open it",
    });
    const smsBody = `${companyName}: ${alert.subject}\n${alert.link}`;
    const ctx = { kind: "staff_alert", estimateId: alert.estimateId ?? null };

    const results = await Promise.all(recipients.map(async (r) => {
      let status = "not_configured";
      if (r.channel === "email") {
        if (!emailConfigured()) console.log(`[staff-alert:log-driver] email to=${r.to} subject="${alert.subject}" link=${alert.link}`);
        else status = (await sendEmail({ to: r.to, subject: alert.subject, html, ctx })).status;
      } else {
        if (!smsConfigured()) console.log(`[staff-alert:log-driver] sms to=${r.to} body="${smsBody.replace(/\n/g, " ")}"`);
        else status = (await sendSms({ to: r.to, body: smsBody, ctx })).status;
      }
      return { profile_id: r.profileId, channel: r.channel, status };
    }));
    await service.from("staff_notifications").update({ recipients: results }).eq("id", claimId);
    return "sent";
  } catch (e) {
    reportError(e, { where: "notifyStaff", extra: { key: alert.key, entityId: alert.entityId } });
    return "error";
  }
}

// ---- the events ------------------------------------------------------------

const money = (c: number | null | undefined) => "$" + ((c ?? 0) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const jobTitle = (est: { title?: string | null; sent_snapshot?: { jobAddress?: string } | null } | null | undefined, fallback: string) =>
  [est?.title, est?.sent_snapshot?.jobAddress].filter(Boolean).join(" · ") || fallback;
const dateAU = (d: string | null | undefined) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "");

type WoJoin = { id: string; wo_ref: string; estimate_id: string; estimates: { title: string | null; sent_snapshot: { jobAddress?: string } | null } | null };

/** The painter answered a job offer (accept / propose a date / decline). */
export async function staffOfferResponded(service: SupabaseClient, offerId: string): Promise<StaffAlertOutcome> {
  try {
    const { data } = await service
      .from("booking_offers")
      .select("id, state, start_date, proposed_start_date, response_note, decline_reason, work_orders(id, wo_ref, estimate_id, estimates(title, sent_snapshot)), contractors(company_name, profiles(name))")
      .eq("id", offerId).maybeSingle();
    const o = data as {
      id: string; state: string; start_date: string; proposed_start_date: string | null; response_note: string; decline_reason: string;
      work_orders: WoJoin | null; contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
    } | null;
    if (!o?.work_orders) return "error";
    const painter = (o.contractors?.profiles?.name || o.contractors?.company_name || "The painter").trim();
    const job = jobTitle(o.work_orders.estimates, o.work_orders.wo_ref);
    const link = `${siteUrl()}/pc/wo/${o.work_orders.id}`;
    if (o.state === "accepted") {
      return notifyStaff(service, {
        key: "office_job_accepted", entityId: o.id,
        subject: `Job accepted — ${painter} · ${job}`,
        message: `${painter} has accepted ${o.work_orders.wo_ref} (${job}) starting ${dateAU(o.start_date)}.${o.response_note ? `\n\nTheir note: ${o.response_note}` : ""}`,
        link,
        templates: { subject: "officeJobAcceptedSubject", body: "officeJobAcceptedBody" },
        vars: { painter, job, wo_ref: o.work_orders.wo_ref, start_date: dateAU(o.start_date), proposed_line: "", note_line: o.response_note ? `\n\nTheir note: ${o.response_note}` : "" },
      });
    }
    if (o.state === "proposed") {
      return notifyStaff(service, {
        key: "office_job_accepted", entityId: o.id,
        subject: `Job accepted with a new date — ${painter} · ${job}`,
        message: `${painter} will take ${o.work_orders.wo_ref} (${job}) but has proposed ${dateAU(o.proposed_start_date)} instead of ${dateAU(o.start_date)}. It needs your OK on the job page.${o.response_note ? `\n\nTheir note: ${o.response_note}` : ""}`,
        link,
        templates: { subject: "officeJobAcceptedSubject", body: "officeJobAcceptedBody" },
        vars: {
          painter, job, wo_ref: o.work_orders.wo_ref, start_date: dateAU(o.start_date),
          proposed_line: ` They have proposed ${dateAU(o.proposed_start_date)} instead — it needs your OK on the job page.`,
          note_line: o.response_note ? `\n\nTheir note: ${o.response_note}` : "",
        },
      });
    }
    if (o.state === "declined") {
      return notifyStaff(service, {
        key: "office_job_declined", entityId: o.id,
        subject: `Job declined — ${painter} · ${job}`,
        message: `${painter} has declined ${o.work_orders.wo_ref} (${job}) for ${dateAU(o.start_date)}.${o.decline_reason ? `\n\nReason: ${o.decline_reason}` : ""}\n\nThe job is back with the office to re-offer.`,
        link,
        templates: { subject: "officeJobDeclinedSubject", body: "officeJobDeclinedBody" },
        vars: { painter, job, wo_ref: o.work_orders.wo_ref, start_date: dateAU(o.start_date), reason_line: o.decline_reason ? `\n\nReason: ${o.decline_reason}` : "" },
      });
    }
    return "nobody";
  } catch (e) {
    reportError(e, { where: "staffOfferResponded", extra: { offerId } });
    return "error";
  }
}

/** A payment landed on a customer invoice — by the office or by card. */
export async function staffInvoicePaid(service: SupabaseClient, paymentId: string): Promise<StaffAlertOutcome> {
  try {
    const { data } = await service
      .from("payments")
      .select("id, amount_cents, method, invoices(number, estimate_id, estimates(title, accepted_name, sent_snapshot))")
      .eq("id", paymentId).maybeSingle();
    const p = data as {
      id: string; amount_cents: number; method: string | null;
      invoices: { number: string | null; estimate_id: string; estimates: { title: string | null; accepted_name: string | null; sent_snapshot: { jobAddress?: string } | null } | null } | null;
    } | null;
    if (!p?.invoices) return "error";
    const job = jobTitle(p.invoices.estimates, "the job");
    const who = p.invoices.estimates?.accepted_name || "The customer";
    return notifyStaff(service, {
      key: "office_invoice_paid", entityId: p.id,
      subject: `Invoice paid — ${money(p.amount_cents)} · ${job}`,
      message: `${who} has paid ${money(p.amount_cents)} on invoice ${p.invoices.number ?? ""} for ${job}${p.method ? ` (${p.method})` : ""}.`,
      link: `${siteUrl()}/invoicing/job/${p.invoices.estimate_id}`,
      templates: { subject: "officeInvoicePaidSubject", body: "officeInvoicePaidBody" },
      vars: { who, amount: money(p.amount_cents), invoice_number: p.invoices.number ?? "", job, method: p.method ?? "recorded by the office" },
    });
  } catch (e) {
    reportError(e, { where: "staffInvoicePaid", extra: { paymentId } });
    return "error";
  }
}

/** The painter raised a variation from the portal. */
export async function staffVariationRaised(service: SupabaseClient, variationId: string): Promise<StaffAlertOutcome> {
  try {
    const { data } = await service
      .from("wo_variations")
      .select("id, category, comment, est_hours, work_orders(id, wo_ref, estimate_id, estimates(title, sent_snapshot), contractors(company_name, profiles(name)))")
      .eq("id", variationId).maybeSingle();
    const v = data as {
      id: string; category: string; comment: string; est_hours: number | null;
      work_orders: (WoJoin & { contractors: { company_name: string | null; profiles: { name: string | null } | null } | null }) | null;
    } | null;
    if (!v?.work_orders) return "error";
    const painter = (v.work_orders.contractors?.profiles?.name || v.work_orders.contractors?.company_name || "The painter").trim();
    const job = jobTitle(v.work_orders.estimates, v.work_orders.wo_ref);
    const category = v.category.replace(/_/g, " ");
    return notifyStaff(service, {
      key: "office_variation_raised", entityId: v.id,
      subject: `Variation raised — ${job}`,
      message: `${painter} has raised a variation on ${v.work_orders.wo_ref} (${job}): ${category}${v.est_hours ? `, about ${v.est_hours} h` : ""}.\n\n“${v.comment}”\n\nIt is waiting to be priced.`,
      link: `${siteUrl()}/pc/wo/${v.work_orders.id}`,
      templates: { subject: "officeVariationRaisedSubject", body: "officeVariationRaisedBody" },
      vars: { painter, job, wo_ref: v.work_orders.wo_ref, category, hours_line: v.est_hours ? `, about ${v.est_hours} h` : "", comment: v.comment },
    });
  } catch (e) {
    reportError(e, { where: "staffVariationRaised", extra: { variationId } });
    return "error";
  }
}

/** A contractor invoice (or payment claim) was submitted. */
export async function staffContractorInvoice(service: SupabaseClient, invoiceId: string): Promise<StaffAlertOutcome> {
  try {
    const { data } = await service
      .from("contractor_invoices")
      .select("id, number, total_inc_cents, status, contractors(company_name, profiles(name)), work_orders(id, wo_ref, estimate_id, estimates(title, sent_snapshot))")
      .eq("id", invoiceId).maybeSingle();
    const ci = data as {
      id: string; number: string | null; total_inc_cents: number; status: string;
      contractors: { company_name: string | null; profiles: { name: string | null } | null } | null; work_orders: WoJoin | null;
    } | null;
    if (!ci?.work_orders) return "error";
    const painter = (ci.contractors?.company_name || ci.contractors?.profiles?.name || "A painter").trim();
    const job = jobTitle(ci.work_orders.estimates, ci.work_orders.wo_ref);
    return notifyStaff(service, {
      key: "office_contractor_invoice", entityId: ci.id,
      subject: `Contractor invoice in — ${painter} · ${money(ci.total_inc_cents)}`,
      message: `${painter} has submitted invoice ${ci.number ?? ""} for ${money(ci.total_inc_cents)} on ${ci.work_orders.wo_ref} (${job}). It is waiting for approval in Payments.`,
      link: `${siteUrl()}/invoicing/ci/${ci.id}`,
      templates: { subject: "officeContractorInvoiceSubject", body: "officeContractorInvoiceBody" },
      vars: { painter, amount: money(ci.total_inc_cents), invoice_number: ci.number ?? "", wo_ref: ci.work_orders.wo_ref, job },
    });
  } catch (e) {
    reportError(e, { where: "staffContractorInvoice", extra: { invoiceId } });
    return "error";
  }
}

// ---- Tom, 7 Oct 2026: PC Command alerts ------------------------------------

/** The painter declined a change the client approved — back with the office. Once per variation. */
export async function staffVariationDeclinedByPainter(service: SupabaseClient, variationId: string): Promise<StaffAlertOutcome> {
  try {
    const { data, error } = await service
      .from("wo_variations")
      .select("id, est_hours, contractor_decline_note, work_orders(id, wo_ref, estimate_id, estimates(title, sent_snapshot), contractors(company_name, profiles(name)))")
      .eq("id", variationId).maybeSingle();
    if (error) throw error;
    const v = data as {
      id: string; est_hours: number | null; contractor_decline_note: string | null;
      work_orders: (WoJoin & { contractors: { company_name: string | null; profiles: { name: string | null } | null } | null }) | null;
    } | null;
    if (!v?.work_orders) return "error";
    const painter = (v.work_orders.contractors?.profiles?.name || v.work_orders.contractors?.company_name || "The painter").trim();
    const job = jobTitle(v.work_orders.estimates, v.work_orders.wo_ref);
    const comment = (v.contractor_decline_note ?? "").trim() || "(no note)";
    const hours_line = v.est_hours ? ` (${v.est_hours} h)` : "";
    return notifyStaff(service, {
      key: "office_variation_declined", entityId: v.id,
      subject: `Painter declined an approved change — ${job}`,
      message: `${painter} has declined the change the client approved on ${v.work_orders.wo_ref} (${job})${hours_line}.\n\nThey wrote: “${comment}”\n\nIt is back with you in PC Command — revise it with the client, or set the painter's amount.`,
      link: `${siteUrl()}/pc/wo/${v.work_orders.id}#variation-${v.id}`,
      templates: { subject: "officeVariationDeclinedSubject", body: "officeVariationDeclinedBody" },
      vars: { painter, job, wo_ref: v.work_orders.wo_ref, hours_line, comment },
      estimateId: v.work_orders.estimate_id,
    });
  } catch (e) {
    reportError(e, { where: "staffVariationDeclinedByPainter", extra: { variationId } });
    return "error";
  }
}

async function woForAlert(service: SupabaseClient, workOrderId: string) {
  const { data, error } = await service
    .from("work_orders")
    .select("id, wo_ref, estimate_id, estimates(title, sent_snapshot), contractors(company_name, profiles(name))")
    .eq("id", workOrderId).maybeSingle();
  if (error) throw error; // the callers' try/catch reports it
  const w = data as (WoJoin & { contractors: { company_name: string | null; profiles: { name: string | null } | null } | null }) | null;
  if (!w) return null;
  return {
    w,
    painter: (w.contractors?.profiles?.name || w.contractors?.company_name || "The painter").trim(),
    job: jobTitle(w.estimates, w.wo_ref),
  };
}

/** A customer update was drafted from the painter's ticks — confirm and send it. Once per job per Melbourne day. */
export async function staffCustomerUpdateDrafted(service: SupabaseClient, workOrderId: string, day: string): Promise<StaffAlertOutcome> {
  try {
    const got = await woForAlert(service, workOrderId);
    if (!got) return "error";
    const { w, painter, job } = got;
    return notifyStaff(service, {
      key: "office_update_drafted", entityId: `${w.id}:${day}`,
      subject: `Customer update ready to send — ${job}`,
      message: `${painter} has updated their work order on ${w.wo_ref} (${job}). A customer update has been drafted from it — read it, change anything, and send it.`,
      link: `${siteUrl()}/pc/updates`,
      templates: { subject: "officeUpdateDraftedSubject", body: "officeUpdateDraftedBody" },
      vars: { painter, job, wo_ref: w.wo_ref, hours_line: "", comment: "" },
      estimateId: w.estimate_id,
    });
  } catch (e) {
    reportError(e, { where: "staffCustomerUpdateDrafted", extra: { workOrderId } });
    return "error";
  }
}

/** The customer is due an update and nothing is drafted — write one. Once per job per Melbourne day while due. */
export async function staffCustomerUpdateDue(service: SupabaseClient, workOrderId: string, day: string, quietDays: number): Promise<StaffAlertOutcome> {
  try {
    const got = await woForAlert(service, workOrderId);
    if (!got) return "error";
    const { w, painter, job } = got;
    const hours_line = quietDays > 0 ? ` — nothing sent for ${quietDays} day${quietDays === 1 ? "" : "s"}` : "";
    return notifyStaff(service, {
      key: "office_update_due", entityId: `${w.id}:${day}`,
      subject: `Customer update due — ${job}`,
      message: `The customer on ${w.wo_ref} (${job}) is due an update${hours_line}. Nothing is drafted — write them a line on progress from the job page.`,
      link: `${siteUrl()}/pc/wo/${w.id}`,
      templates: { subject: "officeUpdateDueSubject", body: "officeUpdateDueBody" },
      vars: { painter, job, wo_ref: w.wo_ref, hours_line, comment: "" },
      estimateId: w.estimate_id,
    });
  } catch (e) {
    reportError(e, { where: "staffCustomerUpdateDue", extra: { workOrderId } });
    return "error";
  }
}
