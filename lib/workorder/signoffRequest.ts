import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAutomation } from "@/lib/automations/dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { buildPlainEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { realOnly } from "@/lib/demo/scope";

/**
 * Tom, 22 Oct 2026: send the customer the sign-off link when they were not at the
 * walkthrough. The same words and link as the sign-off reminder ladder (the /s/<token>
 * page), sent now, once per press; the ladder keeps going as before. Needs the completion
 * pack to exist (the walkthrough was started), which is what makes the token.
 */
export async function sendSignoffRequest(service: SupabaseClient, workOrderId: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const { data, error } = await realOnly(service.from("wo_signoff")
    .select("work_order_id, customer_token, signed_at, evidence_pack_sent_at, work_orders(stage, estimate_id, wo_snapshot, estimates(account_id, accepted_name, contact_email:sent_snapshot->>contactEmail, contact_phone:builder_state->contact->>phone, contact_first:builder_state->contact->>first_name, job_address:sent_snapshot->>jobAddress))"))
    .eq("work_order_id", workOrderId).maybeSingle();
  if (error) return { ok: false, message: `Couldn't read the sign-off: ${error.message}` };
  type Row = { customer_token: string | null; signed_at: string | null; evidence_pack_sent_at: string | null;
    work_orders: { stage: string; estimate_id: string | null; wo_snapshot: { jobAddress?: string } | null; estimates: { account_id: string | null; accepted_name: string | null; contact_email: string | null; contact_phone: string | null; contact_first: string | null; job_address: string | null } | null } | null };
  const r = data as unknown as Row | null;
  if (!r || !r.customer_token || !r.evidence_pack_sent_at) return { ok: false, message: "Start the walkthrough first — that sends the completion pack and makes the customer's sign-off link." };
  if (r.signed_at) return { ok: false, message: "This job is already signed off." };
  const e = r.work_orders?.estimates;
  const email = e?.contact_email && !isTestEmail(e.contact_email) ? e.contact_email : null;
  const phone = e?.contact_phone ? normalisePhoneAU(e.contact_phone) : null;
  if (!email && !phone) return { ok: false, message: "The customer has no email or phone on the estimate." };
  const { messaging, company } = await loadMessaging(service);
  const companyName = company.name || "Paint Group";
  const link = `${siteUrl()}/s/${r.customer_token}`;
  const first = (e?.contact_first || (e?.accepted_name ?? "").trim().split(/\s+/)[0] || "there").trim();
  const vars = {
    first_name: first, address: e?.job_address || r.work_orders?.wo_snapshot?.jobAddress || "your property",
    reminder: "The walkthrough was done without you there — please look through the photos and the report, and sign when you are happy.",
    company_name: companyName, link,
  };
  const sent = await sendAutomation(service, {
    key: "signoff_reminder",
    to: { email, phone },
    email: { subject: renderTemplate(messaging.signoffReminderSubject, vars), html: buildPlainEmailHtml({ heading: "Please review and sign off", message: renderTemplate(messaging.signoffReminderBody, vars), companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }) },
    sms: { body: renderTemplate(messaging.signoffReminderSms, vars) },
    ctx: { accountId: e?.account_id ?? null, estimateId: r.work_orders?.estimate_id ?? null, workOrderId, kind: "signoff_reminder" },
  });
  if (sent.outcome === "error") return { ok: false, message: sent.message };
  if (sent.outcome !== "sent") return { ok: false, message: sent.outcome === "off" ? "Sign-off reminders are switched off in Settings → Automations." : sent.outcome === "nobody" ? sent.detail : "Held — it will go when the hold lifts." };
  const { error: evErr } = await service.from("wo_events").insert({ work_order_id: workOrderId, type: "signoff_request_sent", actor_kind: "staff", meta: { to: { email, phone: Boolean(phone) }, channels: sent.channels } });
  if (evErr) return { ok: true, message: `Sent to the customer (${[email, phone ? "text" : null].filter(Boolean).join(" + ")}), but the event did not record: ${evErr.message}` };
  return { ok: true, message: `Sent to the customer — ${[email, phone ? "and a text" : null].filter(Boolean).join(" ")}. They review the photos and sign at their link.` };
}
