import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, sendSms, type DeliveryResult } from "@/lib/messaging/send";
import { normalisePhoneAU } from "@/lib/messaging/config";
import { buildInvoiceEmailHtml } from "@/lib/invoicing/sendInvoice";
import { siteUrl } from "@/lib/invoicing/pdf";
import { loadCustomerContact } from "@/lib/workorder/customerContact";

/**
 * "You approved this by phone — here it is in writing." SERVER ONLY.
 *
 * Tom, 17 Sep 2026: the office can confirm a priced variation on the
 * customer's behalf after a verbal OK; the customer then gets a confirmation
 * of what was approved, on email and text where both are on file, so a
 * phone-call approval never lives only in someone's memory. Best-effort on
 * top of the guarded status change — the approval stands whether or not the
 * message lands, and the outcome is returned so the screen can say which.
 */
export type ConfirmationOutcome = {
  email?: { status: DeliveryResult["status"]; message?: string };
  sms?: { status: DeliveryResult["status"]; message?: string };
  /** Why nothing was attempted at all, in the office's words. */
  skipped?: string;
};

const money = (c: number) =>
  "$" + (Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" })
    .format(new Date(iso));

export async function sendVariationConfirmation(
  db: SupabaseClient,
  variationId: string,
): Promise<ConfirmationOutcome> {
  const { data: v, error } = await db
    .from("wo_variations")
    .select("id, status, credit, price_cents, comment, customer_token, signed_name, verbal_confirmed_at, work_orders(estimate_id, wo_ref, wo_snapshot)")
    .eq("id", variationId)
    .maybeSingle();
  if (error) return { skipped: `Couldn't read the variation: ${error.message}` };
  const row = v as unknown as {
    id: string; status: string; credit: boolean; price_cents: number | null; comment: string;
    customer_token: string | null; signed_name: string | null; verbal_confirmed_at: string | null;
    work_orders: { estimate_id: string | null; wo_ref: string; wo_snapshot: { jobAddress?: string } | null } | null;
  } | null;
  if (!row) return { skipped: "That variation no longer exists." };
  if (row.status !== "customer_approved" || !row.verbal_confirmed_at) {
    return { skipped: "Only a verbally approved variation gets this confirmation." };
  }
  if (!row.work_orders?.estimate_id) return { skipped: "The job has no estimate to find the customer on." };

  const loaded = await loadCustomerContact(db, row.work_orders.estimate_id);
  if (!loaded.ok) return { skipped: loaded.message };
  const { contact, accountId } = loaded;
  if (!contact.email && !contact.phone) {
    return { skipped: "No email or mobile on the estimate's contact — nothing to send the confirmation to." };
  }

  const { data: companyRow, error: companyErr } = await db
    .from("settings").select("value").eq("key", "company_profile").maybeSingle();
  if (companyErr) return { skipped: `Couldn't read the company profile: ${companyErr.message}` };
  const company = ((companyRow as { value?: { name?: string; email?: string; phone?: string } } | null)?.value) ?? {};
  const companyName = company.name || "Paint Group";

  const amount = money(row.price_cents ?? 0);
  const address = row.work_orders.wo_snapshot?.jobAddress || "your job";
  const what = row.credit
    ? `a change taking ${amount} off your job total`
    : `extra work adding ${amount} to your job total`;
  const when = longDate(row.verbal_confirmed_at);
  const who = row.signed_name || contact.firstName;
  const link = row.customer_token ? `${siteUrl()}/v/${row.customer_token}` : `${siteUrl()}/account`;
  const ctx = { estimateId: row.work_orders.estimate_id, accountId, kind: "variation_confirmed" };

  const out: ConfirmationOutcome = {};

  // Always through sendEmail/sendSms — an unconfigured server still records
  // the attempt in `messages`, so the CRM record shows what was tried.
  if (contact.email) {
    const sent = await sendEmail({
      ctx,
      to: contact.email,
      subject: `Confirmed: the change you approved on ${address} — ${companyName}`,
      replyTo: company.email || undefined,
      html: buildInvoiceEmailHtml({
        companyName,
        heading: "Your approval, in writing",
        intro:
          `Hello ${contact.firstName},\n\n` +
          `On ${when}, ${who} approved ${what} over the phone: ${row.comment || "a scope change"}. ` +
          `We've recorded that approval, and ${row.credit ? `the ${amount} comes off your final invoice` : `the ${amount} will appear on your final invoice`}.\n\n` +
          `If that isn't right, reply to this email${company.phone ? ` or call us on ${company.phone}` : ""} and we'll sort it out.`,
        link,
        buttonLabel: "See the change",
        bank: {},
        reference: null,
      }),
    });
    out.email = { status: sent.status, ...("message" in sent ? { message: sent.message } : {}) };
    if (sent.status === "not_configured") console.log(`[variation-confirm:log-driver] to=${contact.email} link=${link}`);
  }

  if (contact.phone) {
    const to = normalisePhoneAU(contact.phone);
    if (!to) {
      out.sms = { status: "error", message: "That mobile number doesn't look Australian." };
    } else {
      const sent = await sendSms({
        ctx,
        to,
        body: `${companyName}: confirming ${what} on ${address}, approved by phone on ${when}. Details: ${link}`,
      });
      out.sms = { status: sent.status, ...("message" in sent ? { message: sent.message } : {}) };
      if (sent.status === "not_configured") console.log(`[variation-confirm:log-driver] sms=${contact.phone} link=${link}`);
    }
  }

  return out;
}

/** The office's one-line read of what happened. */
export function describeConfirmation(o: ConfirmationOutcome): string {
  if (o.skipped) return `Confirmation not sent — ${o.skipped}`;
  const bits: string[] = [];
  for (const [label, r] of [["email", o.email], ["text", o.sms]] as const) {
    if (!r) continue;
    if (r.status === "sent") bits.push(`${label} sent`);
    else if (r.status === "not_configured") bits.push(`${label} not configured on this server`);
    else if (r.status === "suppressed") bits.push(`${label} suppressed (${r.message ?? "customer switched it off"})`);
    else bits.push(`${label} failed (${r.message ?? "unknown error"})`);
  }
  return bits.length ? `Confirmation: ${bits.join(", ")}.` : "Confirmation: nothing went out.";
}
