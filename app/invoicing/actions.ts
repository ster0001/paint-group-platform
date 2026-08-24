"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureInvoicePdf, ensureReceiptPdf } from "@/lib/invoicing/pdf";
import { sendInvoiceEmail, sendReceiptEmail } from "@/lib/invoicing/sendInvoice";

/**
 * Invoicing actions — thin, zod-validated translations over the Step 1/2
 * SECURITY DEFINER RPCs. No money rule lives here: amounts that look like
 * money are INTENT (a percent choice, an operator-entered figure) and the
 * server functions recompute, bound and refuse (§4.2). Every mutation
 * revalidates the three §7 surfaces.
 */

export type InvoicingResult = { ok: true; message?: string; id?: string } | { ok: false; message: string };

const uuid = z.string().uuid();

const WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  not_found: "That invoice no longer exists.",
  not_draft: "Only drafts can be changed — issued invoices are locked.",
  not_payable: "This invoice isn't open for payment.",
  not_sendable: "This invoice isn't in a sendable state.",
  not_voidable: "This invoice can't be voided from its current state.",
  paid_use_credit_note: "A paid invoice is corrected with a credit note, not a void.",
  not_writeoffable: "This invoice can't be written off from its current state.",
  reason_required: "A reason is required.",
  bad_amount: "That amount doesn't look right.",
  bad_percent: "The percentage must be between 0 and 100.",
  exceeds_balance: "That's more than the remaining balance.",
  exceeds_contract: "That's more than the job's adjusted contract.",
  stripe_via_webhook: "Card payments record themselves through Stripe.",
  nothing_to_invoice: "There's nothing to invoice.",
  not_accepted: "This job hasn't been accepted yet.",
  no_description: "Give the line a description.",
  no_comment: "Say what the variation is.",
  not_final_draft: "Reconciliation applies to the draft final invoice.",
  nothing_to_reconcile: "The document already reconciles to the ledger.",
  use_line_editor: "Edit this invoice's lines in the document view.",
  not_open: "This invoice isn't open.",
  bad_date: "Pick a date.",
};

function revalidateAll(estimateId?: string, invoiceId?: string) {
  revalidatePath("/invoicing");
  if (estimateId) revalidatePath(`/invoicing/job/${estimateId}`);
  if (invoiceId) revalidatePath(`/invoicing/inv/${invoiceId}`);
}

async function call(
  fn: string,
  args: Record<string, unknown>,
  paths: { estimateId?: string; invoiceId?: string },
  okWording?: string,
): Promise<InvoicingResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidateAll(paths.estimateId, paths.invoiceId);
    const tail = s.slice(3);
    return { ok: true, message: okWording, id: /^[0-9a-f-]{36}$/.test(tail) ? tail : undefined };
  }
  const reason = s.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? `Couldn't do that (${reason || "unknown"}).` };
}

// ---- drafting -------------------------------------------------------------

const requestPaymentInput = z.object({
  estimateId: uuid,
  mode: z.enum(["percent", "fixed"]),
  // percent 0–100, or an operator-entered figure in whole cents — either way
  // it's intent; invoice_request_payment computes and bounds server-side.
  value: z.number().positive().max(100_000_000),
});

export async function requestPaymentAction(raw: unknown): Promise<InvoicingResult> {
  const p = requestPaymentInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and try again." };
  return call(
    "invoice_request_payment",
    { p_estimate_id: p.data.estimateId, p_mode: p.data.mode, p_value: p.data.value },
    { estimateId: p.data.estimateId },
    "Draft created.",
  );
}

export async function invoiceInFullAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ estimateId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call(
    "invoice_create_final",
    { p_estimate_id: p.data.estimateId },
    { estimateId: p.data.estimateId },
    "Final invoice drafted from the ledger.",
  );
}

// ---- the state machine ----------------------------------------------------

const invoiceRef = z.object({ invoiceId: uuid, estimateId: uuid });

export async function issueInvoiceAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call(
    "invoice_issue",
    { p_invoice_id: p.data.invoiceId },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Issued — number allocated.",
  );
}

export async function recordPaymentAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef
    .extend({
      method: z.enum(["bank_transfer", "cash", "other"]),
      amountCents: z.number().int().positive().max(100_000_000),
      reference: z.string().max(120).default(""),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and try again." };
  const result = await call(
    "invoice_record_payment",
    {
      p_invoice_id: p.data.invoiceId,
      p_method: p.data.method,
      p_amount_cents: p.data.amountCents,
      p_reference: p.data.reference,
    },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Payment recorded — receipt on its way.",
  );
  if (result.ok) {
    // Receipt PDF + email ride behind the response (§6.7) — recording a
    // payment on the phone must not wait for Chromium.
    const invoiceId = p.data.invoiceId;
    after(async () => {
      const service = createServiceClient();
      if (!service) return;
      const { data } = await service
        .from("payments").select("id").eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const paymentId = (data as { id: string } | null)?.id;
      if (!paymentId) return;
      await ensureReceiptPdf(paymentId);
      await sendReceiptEmail(service, paymentId);
    });
  }
  return result;
}

/**
 * The mockup's primary: Issue & send… — allocate the number, lock the
 * document, render the PDF (a print of the customer page), email the
 * customer their link. Each stage degrades with a plain-English message
 * rather than blocking the one before it.
 */
export async function issueAndSendAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };

  const issued = await call(
    "invoice_issue",
    { p_invoice_id: p.data.invoiceId },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
  );
  if (!issued.ok) return issued;

  return finishSend(p.data.invoiceId, p.data.estimateId, "Issued");
}

/** Re-send an already-issued invoice (records a resend event). */
export async function resendInvoiceAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return finishSend(p.data.invoiceId, p.data.estimateId, "Ready");
}

async function finishSend(
  invoiceId: string,
  estimateId: string,
  verb: string,
): Promise<InvoicingResult> {
  const pdfPath = await ensureInvoicePdf(invoiceId);
  const service = createServiceClient();
  const outcome = service
    ? await sendInvoiceEmail(service, invoiceId)
    : ({ status: "error", message: "service unavailable" } as const);

  if (outcome.status === "sent") {
    await call("invoice_send", { p_invoice_id: invoiceId, p_channel: "email" },
      { estimateId, invoiceId });
    revalidateAll(estimateId, invoiceId);
    return { ok: true, message: `${verb} and emailed to ${outcome.to}.${pdfPath ? "" : " (PDF still generating — try the PDF button shortly.)"}` };
  }
  revalidateAll(estimateId, invoiceId);
  if (outcome.status === "no_recipient") {
    return { ok: true, message: `${verb}. No customer email on file — copy the pay link and send it yourself.` };
  }
  if (outcome.status === "not_configured") {
    return { ok: true, message: `${verb}. Email sending isn't switched on yet — copy the pay link and send it yourself.` };
  }
  return { ok: true, message: `${verb}, but the email failed to send — copy the pay link and send it yourself.` };
}

export async function voidInvoiceAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ reason: z.string().min(1).max(400) }).safeParse(raw);
  if (!p.success) return { ok: false, message: WORDING.reason_required };
  return call(
    "invoice_void",
    { p_invoice_id: p.data.invoiceId, p_reason: p.data.reason },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Voided — the number is burnt, not reused.",
  );
}

export async function deleteDraftAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call(
    "invoice_delete_draft",
    { p_invoice_id: p.data.invoiceId },
    { estimateId: p.data.estimateId },
    "Draft deleted.",
  );
}

// ---- §7.3 draft editing ---------------------------------------------------

export async function updateLineAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef
    .extend({
      lineId: uuid,
      description: z.string().min(1).max(600),
      amountExCents: z.number().int().min(-100_000_000).max(100_000_000),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the line and try again." };
  return call(
    "invoice_update_line",
    {
      p_line_id: p.data.lineId,
      p_description: p.data.description,
      p_amount_ex_cents: p.data.amountExCents,
    },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
  );
}

export async function addLineAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef
    .extend({
      description: z.string().min(1).max(600),
      amountExCents: z.number().int().min(-100_000_000).max(100_000_000),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the line and try again." };
  return call(
    "invoice_add_line",
    {
      p_invoice_id: p.data.invoiceId,
      p_description: p.data.description,
      p_amount_ex_cents: p.data.amountExCents,
    },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
  );
}

export async function removeLineAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ lineId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call(
    "invoice_remove_line",
    { p_line_id: p.data.lineId },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
  );
}

export async function setDraftTotalAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef
    .extend({ totalIncCents: z.number().int().positive().max(100_000_000) })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and try again." };
  return call(
    "invoice_set_draft_total",
    { p_invoice_id: p.data.invoiceId, p_total_inc_cents: p.data.totalIncCents },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Amended.",
  );
}

// ---- §7.3 reconciliation banner ------------------------------------------

export async function reconcileAdjustmentAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ note: z.string().max(400).default("") }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call(
    "invoice_reconcile_adjustment",
    { p_invoice_id: p.data.invoiceId, p_note: p.data.note },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Kept as a one-off adjustment — recorded.",
  );
}

export async function recordDriftAsVariationAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ comment: z.string().min(1).max(400) }).safeParse(raw);
  if (!p.success) return { ok: false, message: WORDING.no_comment };
  return call(
    "invoice_record_drift_as_variation",
    { p_invoice_id: p.data.invoiceId, p_comment: p.data.comment },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Recorded as a variation — the ledger now agrees.",
  );
}
