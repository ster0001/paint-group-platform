import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { automationOn, normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { reportError } from "@/lib/monitoring/report";
import { siteUrl } from "./pdf";

/**
 * SERVER ONLY — the invoice send pipeline, behind the platform's existing
 * provider interface (lib/messaging: Resend for email). ⚑16: when no
 * provider is configured the pipeline degrades to the log driver — the full
 * message is written to the server log and the caller is told, so issuing
 * never depends on a provider decision. Customer copy is ENGLISH tone.
 */

export type InvoiceSendOutcome =
  | { status: "sent"; to: string }
  | { status: "no_recipient" }
  | { status: "not_configured"; to: string }
  /** Switched off on Settings → Automations — nothing sent, nothing wrong. */
  | { status: "skipped" }
  | { status: "error"; message: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDay = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(iso + "T00:00:00Z"))
    : "";

export function buildInvoiceEmailHtml(opts: {
  companyName: string;
  heading: string;
  intro: string;
  link: string;
  buttonLabel: string;
  bank: Record<string, string>;
  reference: string | null;
}): string {
  const introHtml = opts.intro
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 15px;font-size:15px;line-height:1.6;color:#1f2937;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const bankRows = [
    ["Account name", opts.bank.accountName],
    ["Bank", opts.bank.bank],
    ["BSB", opts.bank.bsb],
    ["Account", opts.bank.acc],
    ["Reference", opts.reference ?? ""],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 14px 3px 0;font-size:13px;color:#6b7280;">${esc(k!)}</td>` +
        `<td style="padding:3px 0;font-size:13px;color:#111827;font-weight:600;font-family:ui-monospace,Menlo,monospace;">${esc(v!)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 32px 16px;border-bottom:1px solid #e5e7eb;">
        <span style="font-size:19px;font-weight:700;letter-spacing:.08em;color:#111827;">PAINT<span style="color:#0e8296;">GROUP</span></span>
      </td></tr>
      <tr><td style="padding:24px 32px 6px;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#111827;">${esc(opts.heading)}</h1>
        ${introHtml}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 10px;"><tr><td style="border-radius:9px;background:#0e8296;">
          <a href="${esc(opts.link)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(opts.buttonLabel)}</a>
        </td></tr></table>
      </td></tr>
      ${bankRows
        ? `<tr><td style="padding:8px 32px 22px;">
        <div style="background:#f4f6f7;border-radius:10px;padding:16px 18px;">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600;">Prefer a bank transfer? No fees, straight to us</p>
          <table role="presentation" cellpadding="0" cellspacing="0">${bankRows}</table>
        </div>
      </td></tr>`
        : ""}
      <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">${esc(opts.companyName)} — if anything on this invoice needs discussing, just reply to this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Email an issued invoice to the customer on file (snapshot contactEmail). */
export async function sendInvoiceEmail(
  service: SupabaseClient,
  invoiceId: string,
  /** Optional personal note from the sender (Tom, 25 Aug) — it leads the
   *  email; the standard amount/due/link paragraph always follows. */
  personalMessage?: string,
): Promise<InvoiceSendOutcome> {
  const { data } = await service
    .from("invoices")
    .select("id, number, kind, status, total_inc_cents, due_on, token, estimates(accepted_name, contact_email:sent_snapshot->>contactEmail, job_address:sent_snapshot->>jobAddress)")
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = data as {
    id: string; number: string | null; kind: string; status: string;
    total_inc_cents: number; due_on: string | null; token: string;
    estimates: { accepted_name: string | null; contact_email: string | null; job_address: string | null } | null;
  } | null;
  if (!inv || inv.status === "draft" || !inv.number) return { status: "error", message: "not issued" };

  const to = inv.estimates?.contact_email?.trim() ?? "";
  if (!to) return { status: "no_recipient" };

  const { data: settings } = await service
    .from("settings").select("key, value").in("key", ["invoicing_entity", "invoicing_bank"]);
  const rows = (settings ?? []) as { key: string; value: Record<string, string> }[];
  const entity = rows.find((r) => r.key === "invoicing_entity")?.value ?? {};
  const bank = rows.find((r) => r.key === "invoicing_bank")?.value ?? {};

  const KIND_PHRASE: Record<string, string> = {
    deposit: "the deposit for your painting work",
    progress: "a payment request for your painting work",
    final: "the final invoice for your completed painting work",
    variation: "an approved variation on your painting work",
    standalone: "your painting work",
  };
  const link = `${siteUrl()}/i/${inv.token}`;
  const firstName = (inv.estimates?.accepted_name ?? "").split(" ")[0] || "there";
  const standard =
    `Please find your invoice ${inv.number} for ${KIND_PHRASE[inv.kind] ?? "your painting work"}` +
    `${inv.estimates?.job_address ? ` at ${inv.estimates.job_address}` : ""}.\n\n` +
    `The amount due is ${money(inv.total_inc_cents)}${inv.due_on ? `, payable by ${longDay(inv.due_on)}` : ""}. ` +
    `You can view the full invoice, download a PDF copy and find our payment details using the button below.`;
  const note = (personalMessage ?? "").trim();
  const intro = `Hello ${firstName},\n\n${note ? `${note}\n\n` : ""}${standard}`;

  const html = buildInvoiceEmailHtml({
    companyName: (entity.tradingName as string) || "Paint Group",
    heading: `Invoice ${inv.number} — ${money(inv.total_inc_cents)}`,
    intro,
    link,
    buttonLabel: "View your invoice",
    bank,
    reference: inv.number,
  });

  if (!emailConfigured()) {
    // ⚑16 log driver: the message is real, the transport isn't chosen yet.
    console.log(`[invoice-send:log-driver] to=${to} subject="Invoice ${inv.number}" link=${link}`);
    return { status: "not_configured", to };
  }
  const result = await sendEmail({ to, subject: `Invoice ${inv.number} from Paint Group`, html });
  if (result.status === "sent") return { status: "sent", to };
  if (result.status === "not_configured") return { status: "not_configured", to };
  reportError(new Error(result.message), { where: "sendInvoiceEmail", extra: { invoiceId } });
  return { status: "error", message: result.message };
}

/**
 * Text the invoice link (Tom, 25 Aug: the sender chooses how the customer
 * receives it — email, text or both). Recipient = the estimate contact's
 * mobile (builder_state, AU-normalised). Short by design; the link carries
 * the document. Optional personal note leads the text.
 */
export async function sendInvoiceSms(
  service: SupabaseClient,
  invoiceId: string,
  personalMessage?: string,
): Promise<InvoiceSendOutcome> {
  const { data } = await service
    .from("invoices")
    .select("id, number, status, total_inc_cents, token, estimates(accepted_name, contact_phone:builder_state->contact->>phone)")
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = data as {
    id: string; number: string | null; status: string; total_inc_cents: number; token: string;
    estimates: { accepted_name: string | null; contact_phone: string | null } | null;
  } | null;
  if (!inv || inv.status === "draft" || !inv.number) return { status: "error", message: "not issued" };

  const phone = normalisePhoneAU(inv.estimates?.contact_phone ?? "");
  if (!phone) return { status: "no_recipient" };

  const link = `${siteUrl()}/i/${inv.token}`;
  const firstName = (inv.estimates?.accepted_name ?? "").split(" ")[0] || "there";
  const note = (personalMessage ?? "").trim();
  const body =
    `Hi ${firstName}, ${note ? `${note} — ` : ""}your invoice ${inv.number} for ${money(inv.total_inc_cents)} ` +
    `from Paint Group is ready: ${link}`;

  if (!smsConfigured()) {
    console.log(`[invoice-sms:log-driver] to=${phone} body="${body.slice(0, 120)}"`);
    return { status: "not_configured", to: phone };
  }
  const result = await sendSms({ to: phone, body });
  if (result.status === "sent") return { status: "sent", to: phone };
  if (result.status === "not_configured") return { status: "not_configured", to: phone };
  reportError(new Error(result.message), { where: "sendInvoiceSms", extra: { invoiceId } });
  return { status: "error", message: result.message };
}

/**
 * Email the remittance advice to the contractor once their invoice is paid
 * (Step 5). The recipient is the contractor's LOGIN email, resolved through
 * the admin API from contractors.profile_id — contractors carry no email
 * column, and the session shape is browser-side only. Best-effort, ⚑16
 * log-driver when unconfigured, PDF link is a short-lived signed URL.
 */
export async function sendRemittanceEmail(
  service: SupabaseClient,
  contractorInvoiceId: string,
  pdfSignedUrl: string | null,
): Promise<InvoiceSendOutcome> {
  const { data } = await service
    .from("contractor_invoices")
    .select("id, number, remittance_number, total_inc_cents, bank_reference, entity_snapshot, contractor_id, contractors(profile_id), work_orders(wo_ref)")
    .eq("id", contractorInvoiceId)
    .maybeSingle();
  const ci = data as {
    id: string; number: string | null; remittance_number: string | null;
    total_inc_cents: number; bank_reference: string;
    entity_snapshot: { company_name?: string } | null;
    contractors: { profile_id: string | null } | null;
    work_orders: { wo_ref: string } | null;
  } | null;
  if (!ci?.remittance_number) return { status: "error", message: "no remittance" };

  let to = "";
  if (ci.contractors?.profile_id) {
    const { data: user } = await service.auth.admin.getUserById(ci.contractors.profile_id);
    to = user?.user?.email?.trim() ?? "";
  }
  if (!to) return { status: "no_recipient" };

  // Settings → Automations: "Remittance advice".
  const { messaging, company: co } = await loadMessaging(service);
  if (!automationOn(messaging, "contractor_remittance")) return { status: "skipped" };
  const company = ci.entity_snapshot?.company_name || "there";
  const rvars = {
    contractor_company: company, invoice_number: ci.number ?? "", wo_ref: ci.work_orders?.wo_ref ?? "",
    amount: money(ci.total_inc_cents), bank_reference: ci.bank_reference ? ` (bank reference ${ci.bank_reference})` : "",
    remittance_number: ci.remittance_number ?? "", company_name: co.name || "Paint Group",
  };
  const html = buildInvoiceEmailHtml({
    companyName: co.name || "Paint Group",
    heading: "Payment sent — remittance advice",
    intro: renderTemplate(messaging.remittanceBody, rvars),
    link: pdfSignedUrl ?? siteUrl() + "/portal/money",
    buttonLabel: pdfSignedUrl ? "Download remittance advice" : "Open your Money tab",
    bank: {},
    reference: null,
  });

  if (!emailConfigured()) {
    console.log(`[invoice-send:log-driver] to=${to} subject="Remittance ${ci.remittance_number}"`);
    return { status: "not_configured", to };
  }
  const result = await sendEmail({ to, subject: renderTemplate(messaging.remittanceSubject, rvars), html });
  if (result.status === "sent") return { status: "sent", to };
  if (result.status === "not_configured") return { status: "not_configured", to };
  reportError(new Error(result.message), { where: "sendRemittanceEmail", extra: { contractorInvoiceId } });
  return { status: "error", message: result.message };
}

/** Email the receipt for a recorded payment — best-effort, never blocking. */
export async function sendReceiptEmail(
  service: SupabaseClient,
  paymentId: string,
): Promise<InvoiceSendOutcome> {
  const { data } = await service
    .from("payments")
    .select("id, amount_cents, receipt_number, invoice_id, invoices(number, token, estimates(accepted_name, contact_email:sent_snapshot->>contactEmail))")
    .eq("id", paymentId)
    .maybeSingle();
  const pay = data as {
    id: string; amount_cents: number; receipt_number: string | null;
    invoices: {
      number: string | null; token: string;
      estimates: { accepted_name: string | null; contact_email: string | null } | null;
    } | null;
  } | null;
  if (!pay?.receipt_number || !pay.invoices?.number) return { status: "error", message: "no receipt" };
  const to = pay.invoices.estimates?.contact_email?.trim() ?? "";
  if (!to) return { status: "no_recipient" };

  // Settings → Automations: "Payment receipt".
  const { messaging, company: co } = await loadMessaging(service);
  if (!automationOn(messaging, "payment_receipt")) return { status: "skipped" };
  const firstName = (pay.invoices.estimates?.accepted_name ?? "").split(" ")[0] || "there";
  const link = `${siteUrl()}/i/${pay.invoices.token}`;
  const pvars = {
    first_name: firstName, amount: money(pay.amount_cents), invoice_number: pay.invoices.number ?? "",
    receipt_number: pay.receipt_number ?? "", company_name: co.name || "Paint Group",
  };
  const html = buildInvoiceEmailHtml({
    companyName: co.name || "Paint Group",
    heading: `Payment received — thank you`,
    intro: renderTemplate(messaging.receiptBody, pvars),
    link,
    buttonLabel: "View your invoice",
    bank: {},
    reference: null,
  });

  if (!emailConfigured()) {
    console.log(`[invoice-send:log-driver] to=${to} subject="Receipt ${pay.receipt_number}" link=${link}`);
    return { status: "not_configured", to };
  }
  const result = await sendEmail({ to, subject: renderTemplate(messaging.receiptSubject, pvars), html });
  if (result.status === "sent") return { status: "sent", to };
  if (result.status === "not_configured") return { status: "not_configured", to };
  reportError(new Error(result.message), { where: "sendReceiptEmail", extra: { paymentId } });
  return { status: "error", message: result.message };
}
