import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEstimateEmailHtml, emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { normalisePhoneAU } from "@/lib/messaging/config";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";

/**
 * Contractor notifications (Tom, 1 Sep #2). SERVER ONLY — service client.
 *
 * Three moments reach the painter's phone now: a job OFFER goes out (text +
 * email, 24h clock), a variation is RELEASED for their approval (text), and a
 * QUALITY CHECK FAILS (text). All best-effort behind after() — a lost text
 * never unwinds the thing it announces; the portal itself always shows the
 * same facts (home-page cards), so the SMS is a tap-saver, not the record.
 *
 * Phone: contractors.phone (20261223) — missing column, unset number or a
 * non-AU shape all degrade to "no text". Email: the login address through
 * auth.admin (contractors carry no email column — the sendInvoice rule).
 */

type ContractorContact = { phone: string | null; email: string | null; firstName: string };

async function contactFor(service: SupabaseClient, contractorId: string): Promise<ContractorContact> {
  const { data, error } = await service
    .from("contractors")
    .select("profile_id, company_name, phone, profiles(name)")
    .eq("id", contractorId)
    .maybeSingle();
  // Pre-20261223 the phone column 42703s the select — retry without it.
  const row = (error
    ? ((await service.from("contractors").select("profile_id, company_name, profiles(name)").eq("id", contractorId).maybeSingle()).data)
    : data) as { profile_id: string | null; company_name: string | null; phone?: string | null; profiles: { name: string | null } | null } | null;
  if (!row) return { phone: null, email: null, firstName: "there" };

  let email: string | null = null;
  if (row.profile_id) {
    const { data: u } = await service.auth.admin.getUserById(row.profile_id);
    email = u?.user?.email ?? null;
  }
  const name = (row.profiles?.name || row.company_name || "").trim();
  return {
    phone: row.phone ? normalisePhoneAU(row.phone) : null,
    email,
    firstName: name.split(/\s+/)[0] || "there",
  };
}

/** One notification per fact — guarded by a wo_events row, the preStart rule. */
async function once(
  service: SupabaseClient,
  workOrderId: string,
  type: string,
  key: Record<string, string>,
): Promise<boolean> {
  const { data } = await service
    .from("wo_events").select("id, meta").eq("work_order_id", workOrderId).eq("type", type).limit(50);
  const seen = ((data ?? []) as { meta: Record<string, string> | null }[])
    .some((e) => Object.entries(key).every(([k, v]) => e.meta?.[k] === v));
  return !seen;
}

const record = (service: SupabaseClient, workOrderId: string, type: string, meta: Record<string, unknown>) =>
  service.from("wo_events").insert({ work_order_id: workOrderId, type, actor_kind: "system", meta });

/** "You have a job offer" — text + email, on send/reassign/re-offer. */
export async function notifyJobOffer(service: SupabaseClient, workOrderId: string, contractorId: string): Promise<void> {
  try {
    const { data: w } = await service
      .from("work_orders").select("wo_ref").eq("id", workOrderId).maybeSingle();
    const woRef = (w as { wo_ref?: string } | null)?.wo_ref ?? "a job";
    const c = await contactFor(service, contractorId);
    const link = `${siteUrl()}/portal/requests`;
    const body = `Paint Group: you have a job offer (${woRef}) — it holds for 24 hours. Open your portal to see it and answer: ${link}`;

    if (c.phone && smsConfigured()) await sendSms({ to: c.phone, body });
    else if (c.phone) console.log(`[offer-sms:log-driver] to=${c.phone} body=${body}`);

    if (c.email && !isTestEmail(c.email)) {
      if (!emailConfigured()) {
        console.log(`[offer-email:log-driver] to=${c.email} link=${link}`);
      } else {
        await sendEmail({
          to: c.email,
          subject: `You have a job offer — ${woRef}`,
          html: buildEstimateEmailHtml({
            companyName: "Paint Group",
            intro:
              `Hi ${c.firstName},\n\n` +
              `Paint Group has offered you a job (${woRef}). The offer holds for 24 hours — ` +
              `sign in to your portal to see the dates, the price and the job sheet, and give your answer.`,
            link,
            buttonLabel: "Open your portal",
          }),
        });
      }
    }
    await record(service, workOrderId, "offer_notified", { contractor_id: contractorId, wo_ref: woRef });
  } catch (e) {
    reportError(e, { where: "notify.jobOffer", extra: { workOrderId } });
  }
}

/** "A variation is approved and waiting for you" — text, once per variation. */
export async function notifyVariationReleased(service: SupabaseClient, variationId: string): Promise<void> {
  try {
    const { data: v } = await service
      .from("wo_variations")
      .select("id, status, released_at, credit, work_order_id, work_orders(wo_ref, contractor_id)")
      .eq("id", variationId)
      .maybeSingle();
    const row = v as {
      id: string; status: string; released_at: string | null; credit: boolean;
      work_order_id: string; work_orders: { wo_ref: string; contractor_id: string | null } | null;
    } | null;
    if (!row?.work_orders?.contractor_id || row.status !== "customer_approved" || !row.released_at) return;
    if (!(await once(service, row.work_order_id, "variation_release_notified", { variation_id: row.id }))) return;

    const c = await contactFor(service, row.work_orders.contractor_id);
    const link = `${siteUrl()}/portal/jobs/${row.work_order_id}`;
    const body = `Paint Group: a variation on ${row.work_orders.wo_ref} is approved and waiting on you — ` +
      `${row.credit ? "acknowledge" : "approve"} it in your dashboard: ${link}`;
    if (c.phone && smsConfigured()) await sendSms({ to: c.phone, body });
    else console.log(`[variation-sms:log-driver] to=${c.phone ?? "-"} body=${body}`);

    await record(service, row.work_order_id, "variation_release_notified", { variation_id: row.id });
  } catch (e) {
    reportError(e, { where: "notify.variationReleased", extra: { variationId } });
  }
}

/** "Areas need rectifying" — text after a failed quality check, once per check. */
export async function notifyQaFail(service: SupabaseClient, checkId: string): Promise<void> {
  try {
    const { data: q } = await service
      .from("wo_qa_checks")
      .select("id, result, work_order_id, work_orders(wo_ref, contractor_id)")
      .eq("id", checkId)
      .maybeSingle();
    const row = q as {
      id: string; result: string | null; work_order_id: string;
      work_orders: { wo_ref: string; contractor_id: string | null } | null;
    } | null;
    if (!row?.work_orders?.contractor_id || row.result !== "fail") return;
    if (!(await once(service, row.work_order_id, "qa_fail_notified", { check_id: row.id }))) return;

    const c = await contactFor(service, row.work_orders.contractor_id);
    const link = `${siteUrl()}/portal/jobs/${row.work_order_id}`;
    const body = `Paint Group: the quality check on ${row.work_orders.wo_ref} found areas that need rectifying. ` +
      `The details and photos are on the job in your portal: ${link}`;
    if (c.phone && smsConfigured()) await sendSms({ to: c.phone, body });
    else console.log(`[qa-fail-sms:log-driver] to=${c.phone ?? "-"} body=${body}`);

    await record(service, row.work_order_id, "qa_fail_notified", { check_id: row.id });
  } catch (e) {
    reportError(e, { where: "notify.qaFail", extra: { checkId } });
  }
}
