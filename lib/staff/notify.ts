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
import { automationOn, normalisePhoneAU } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildEstimateEmailHtml, emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { parseStaffNotify, wantsChannel, type StaffEventKey, type StaffNotifyChannel } from "./notifyEvents";

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

export async function notifyStaff(service: SupabaseClient, alert: StaffAlert): Promise<StaffAlertOutcome> {
  try {
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, alert.key)) return "off";

    // Claim the guard first — a duplicate claim is the signal to stop.
    const claim = await service
      .from("staff_notifications")
      .upsert({ event_key: alert.key, entity_id: alert.entityId }, { onConflict: "event_key,entity_id", ignoreDuplicates: true })
      .select("id");
    if (claim.error) throw claim.error;
    const claimId = (claim.data as { id: string }[] | null)?.[0]?.id;
    if (!claimId) return "already";

    const { data: rows } = await service.from("profiles").select("id, name, phone, staff_notify").eq("role", "staff");
    const staff = (rows ?? []) as StaffProfile[];
    const withEmail = await Promise.all(staff.map(async (p) => {
      const wantsEmail = wantsChannel(parseStaffNotify(p.staff_notify), alert.key, "email");
      if (!wantsEmail) return { ...p, email: null };
      const { data: u } = await service.auth.admin.getUserById(p.id);
      return { ...p, email: u?.user?.email ?? null };
    }));
    const recipients = recipientsFor(withEmail, alert.key, alert.skipEmails);
    if (recipients.length === 0) {
      await service.from("staff_notifications").update({ recipients: [] }).eq("id", claimId);
      return "nobody";
    }

    const companyName = company.name || "Paint Group";
    const html = buildEstimateEmailHtml({
      intro: alert.message, link: alert.link, companyName,
      logoUrl: company.logoUrlLight || company.logoUrl, buttonLabel: "Open it",
    });
    const smsBody = `${companyName}: ${alert.subject}\n${alert.link}`;
    const ctx = { kind: "staff_alert" };

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
      });
    }
    if (o.state === "proposed") {
      return notifyStaff(service, {
        key: "office_job_accepted", entityId: o.id,
        subject: `Job accepted with a new date — ${painter} · ${job}`,
        message: `${painter} will take ${o.work_orders.wo_ref} (${job}) but has proposed ${dateAU(o.proposed_start_date)} instead of ${dateAU(o.start_date)}. It needs your OK on the job page.${o.response_note ? `\n\nTheir note: ${o.response_note}` : ""}`,
        link,
      });
    }
    if (o.state === "declined") {
      return notifyStaff(service, {
        key: "office_job_declined", entityId: o.id,
        subject: `Job declined — ${painter} · ${job}`,
        message: `${painter} has declined ${o.work_orders.wo_ref} (${job}) for ${dateAU(o.start_date)}.${o.decline_reason ? `\n\nReason: ${o.decline_reason}` : ""}\n\nThe job is back with the office to re-offer.`,
        link,
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
    });
  } catch (e) {
    reportError(e, { where: "staffContractorInvoice", extra: { invoiceId } });
    return "error";
  }
}
