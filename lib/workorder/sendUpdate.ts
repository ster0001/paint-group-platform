/**
 * Customer update DELIVERY (Tom, 25 Aug). SERVER ONLY.
 *
 * wo_send_update records that an update went; this module makes it true:
 * an email with the update text, the chosen site photos and a button to the
 * customer's own job page (the estimate token link — the property page until
 * the customer portal lands), and a text with the link. Same rails as
 * everything else (lib/messaging), best-effort after the record — a failed
 * send never un-records the update, it reports and the office resends.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { normalisePhoneAU } from "@/lib/messaging/config";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "@/lib/invoicing/pdf";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type UpdateDelivery = {
  email: "sent" | "no_recipient" | "not_configured" | "error" | "skipped";
  sms: "sent" | "no_recipient" | "not_configured" | "error" | "skipped";
  to?: string;
};

export async function deliverCustomerUpdate(
  service: SupabaseClient,
  updateId: string,
  photoIds: readonly string[],
  via: "email" | "sms" | "both" = "both",
): Promise<UpdateDelivery> {
  const out: UpdateDelivery = { email: "skipped", sms: "skipped" };

  const { data: u } = await service
    .from("wo_updates")
    .select("id, work_order_id, final_text, draft_text, for_date")
    .eq("id", updateId)
    .maybeSingle();
  const update = u as { id: string; work_order_id: string; final_text: string | null; draft_text: string; for_date: string } | null;
  if (!update) return out;

  const { data: w } = await service
    .from("work_orders")
    .select("estimate_id, wo_snapshot, estimates(share_token, accepted_name, contact_email:sent_snapshot->>contactEmail, contact_phone:builder_state->contact->>phone, job_address:sent_snapshot->>jobAddress)")
    .eq("id", update.work_order_id)
    .maybeSingle();
  const wo = w as {
    estimate_id: string;
    wo_snapshot: { jobAddress?: string } | null;
    estimates: {
      share_token: string | null; accepted_name: string | null;
      contact_email: string | null; contact_phone: string | null; job_address: string | null;
    } | null;
  } | null;
  if (!wo?.estimates) return out;

  const text = (update.final_text ?? update.draft_text ?? "").trim();
  const address = wo.estimates.job_address || wo.wo_snapshot?.jobAddress || "your property";
  const firstName = (wo.estimates.accepted_name ?? "").split(" ")[0] || "there";
  const link = wo.estimates.share_token ? `${siteUrl()}/e/${wo.estimates.share_token}` : null;

  // The chosen photos, scoped to THIS job — an id from another job is ignored.
  let photoUrls: string[] = [];
  if (photoIds.length > 0) {
    const { data: rows } = await service
      .from("wo_photos")
      .select("id, storage_path")
      .eq("work_order_id", update.work_order_id)
      .in("id", [...photoIds].slice(0, 8));
    const paths = ((rows ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
    if (paths.length) {
      const { data: signed } = await service.storage
        .from("wo-photos")
        .createSignedUrls(paths, 60 * 60 * 24 * 14); // photos live 14 days in the email
      photoUrls = (signed ?? []).map((s) => s.signedUrl).filter((x): x is string => Boolean(x));
    }
  }

  if (via !== "sms") {
    const to = wo.estimates.contact_email?.trim() ?? "";
    if (!to) out.email = "no_recipient";
    else if (!emailConfigured()) {
      console.log(`[update-send:log-driver] to=${to} link=${link ?? "-"}`);
      out.email = "not_configured";
    } else {
      const photosHtml = photoUrls.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr>` +
          photoUrls.map((p) => `<td style="padding:3px;"><img src="${esc(p)}" width="130" style="display:block;width:130px;height:130px;object-fit:cover;border-radius:8px;" alt="Progress photo"/></td>`).join("") +
          `</tr></table>`
        : "";
      const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:24px 32px 16px;border-bottom:1px solid #e5e7eb;">
    <span style="font-size:19px;font-weight:700;letter-spacing:.08em;color:#111827;">PAINT<span style="color:#0e8296;">GROUP</span></span>
  </td></tr>
  <tr><td style="padding:24px 32px 24px;">
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#111827;">An update on your painting at ${esc(address)}</h1>
    <p style="margin:0 0 15px;font-size:15px;line-height:1.6;color:#1f2937;">Hello ${esc(firstName)},</p>
    <p style="margin:0 0 15px;font-size:15px;line-height:1.6;color:#1f2937;white-space:pre-line;">${esc(text)}</p>
    ${photosHtml}
    ${link ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 6px;"><tr><td style="border-radius:9px;background:#0e8296;">
      <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">View your job</a>
    </td></tr></table>` : ""}
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Paint Group — reply to this email any time and it comes straight to us.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
      const r = await sendEmail({ to, subject: `An update on your painting at ${address}`, html });
      out.email = r.status === "sent" ? "sent" : r.status === "not_configured" ? "not_configured" : "error";
      out.to = to;
      if (out.email === "error") {
        reportError(new Error("update email failed"), { where: "deliverCustomerUpdate.email", extra: { updateId } });
      }
    }
  }

  if (via !== "email") {
    const phone = normalisePhoneAU(wo.estimates.contact_phone ?? "");
    if (!phone) out.sms = "no_recipient";
    else if (!smsConfigured()) out.sms = "not_configured";
    else {
      const body =
        `Hi ${firstName}, an update on your painting at ${address}: ` +
        `${text.slice(0, 180)}${text.length > 180 ? "…" : ""}` +
        `${link ? ` See photos and details: ${link}` : ""}`;
      const r = await sendSms({ to: phone, body });
      out.sms = r.status === "sent" ? "sent" : r.status === "not_configured" ? "not_configured" : "error";
      if (out.sms === "error") {
        reportError(new Error("update sms failed"), { where: "deliverCustomerUpdate.sms", extra: { updateId } });
      }
    }
  }

  return out;
}
