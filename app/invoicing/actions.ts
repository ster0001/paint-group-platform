"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureInvoicePdf, ensureReceiptPdf, ensureRemittancePdf, signedDocUrl, siteUrl } from "@/lib/invoicing/pdf";
import { sendInvoiceEmail, sendInvoiceSms, sendReceiptEmail, sendRemittanceEmail } from "@/lib/invoicing/sendInvoice";
import { staffInvoicePaid } from "@/lib/staff/notify";
import { COST_DOCS_BUCKET, isOwnReceiptPath } from "@/lib/costs/store";
import { sniffKind } from "@/lib/extract/normalise";
import { notifyExpenseDecided } from "@/lib/contractor/notify";
import { reportError } from "@/lib/monitoring/report";
import { paymentsSettings } from "@/lib/invoicing/settings";
import { DEFAULT_MESSAGING, MESSAGING_KEY, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { invoiceBalanceCents, invoiceIsOverdue, type DerivePayment } from "@/lib/invoicing/derive";
import { slotOf, type JobMoneyInvoice } from "@/lib/invoicing/jobMoney";
import type { InvoiceStatus } from "@/lib/invoicing/stateMachine";
import { fmt2 } from "./format";

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
  not_submitted: "The contractor hasn't submitted this yet (only RCTI invoices approve from draft).",
  not_approved: "Approve it first — then mark it paid.",
  // Step 6a — cost capture
  already_decided: "Someone already dealt with this document.",
  no_document: "No source document — a cost can't exist without one.",
  bad_destination: "Pick where this cost belongs.",
  no_job: "Pick the job this cost belongs to.",
  duplicate: "That invoice number is already recorded for this vendor.",
  bad_state: "This cost isn't in the right state for that.",
  already_matched: "That cost is already matched to a job.",
  bad_paid_with: "Pick how it was paid.",
  // Payments merge Step 3 — the quick actions
  already_paid: "That invoice is already paid — nothing was recorded twice.",
  not_reversible: "That payment can't be undone any more.",
  stripe_refund_only: "A card payment is reversed by a refund in Stripe, not here.",
  receipt_sent: "The receipt has already gone to the customer, so this can't be undone here — record a correction instead.",
  undo_expired: "It's too late to undo that payment here.",
  due_in_past: "Pick a due date from today on.",
  deposit_only: "Only a deposit can be changed this way.",
  not_changeable: "Only a sent, unpaid deposit can be changed.",
  has_payments: "Money has already been paid on it — it can't be changed now.",
  same_amount: "That's the amount it already is.",
  bad_mode: "Pick a percentage or an amount.",
  // Step 6 — the Materials block
  unread_amount: "The amount couldn't be read from this document — open it and record it by hand.",
  not_deleted: "That one isn't deleted.",
  call_back_hold: "Reminders are paused because a call back is open — they resume when it is closed.",
  reason_too_long: "Keep the reason under 300 characters.",
  // Step 8
  no_draft_final: "There is no draft final on this job to work out again.",
  nothing_remaining: "Nothing is left to invoice for the contractor on this job — earlier invoices already cover the agreed pay.",
};

function revalidateAll(estimateId?: string, invoiceId?: string) {
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/payments");
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
      // Tom, 1 Oct: the day the money actually arrived, not the day it was
      // typed in. A bare yyyy-mm-dd Melbourne calendar day; absent = today.
      receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      // ⚑P4 "Send notification of payment": off records the money and emails no one.
      notify: z.boolean().default(true),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and date and try again." };
  const result = await call(
    "invoice_record_payment",
    {
      p_invoice_id: p.data.invoiceId,
      p_method: p.data.method,
      p_amount_cents: p.data.amountCents,
      p_reference: p.data.reference,
      p_received_on: p.data.receivedOn ?? null,
    },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    p.data.notify ? "Payment recorded — receipt on its way." : "Payment recorded. Nothing was sent to the customer.",
  );
  if (result.ok) {
    const notify = p.data.notify;
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
      if (notify) await sendClaimedReceipt(service, paymentId);
      else await ensureReceiptPdf(paymentId);   // the record keeps its receipt even when nothing is sent
      await staffInvoicePaid(service, paymentId); // Tom, 10 Sep: staff alert
    });
  }
  return result;
}

/**
 * Send a payment's receipt exactly once, and only while the payment stands:
 * `payment_claim_receipt` stamps it first (Undo is refused from then on), so a
 * receipt and an Undo can never both happen.
 */
async function sendClaimedReceipt(service: NonNullable<ReturnType<typeof createServiceClient>>, paymentId: string): Promise<void> {
  const { data, error } = await service.rpc("payment_claim_receipt", { p_payment_id: paymentId });
  if (error) { reportError(error, { where: "sendClaimedReceipt", extra: { paymentId } }); return; }
  if (data !== "ok:claimed") return;   // undone in the window, or already sent
  // Claimed FIRST, then the slow part: the PDF (headless Chromium) can take seconds,
  // and Undo must be closed the moment the window is — not when the PDF is done.
  await ensureReceiptPdf(paymentId);
  await sendReceiptEmail(service, paymentId);
}

// ---- Payments merge Step 3: the quick actions (brief §4.3) ----------------------

/** The Undo window and the other ⚑ defaults, from Settings → Invoicing. */
async function loadPaymentsSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key, value").eq("key", "invoicing");
  if (error) reportError(error, { where: "loadPaymentsSettings", bestEffort: true });
  return paymentsSettings((data ?? []) as { key: string; value: unknown }[]);
}

/**
 * "✓ Paid $X" — one press: the full balance, bank transfer, today. The amount
 * is the server's (invoice_record_full_payment), so a second press records
 * nothing. The receipt waits for the Undo window to close (⚑P2, Tom 13 Oct).
 */
export async function quickPayAction(raw: unknown): Promise<InvoicingResult & { undoSeconds?: number }> {
  const p = invoiceRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const settings = await loadPaymentsSettings();
  const result = await call(
    "invoice_record_full_payment",
    { p_invoice_id: p.data.invoiceId, p_method: "bank_transfer" },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    "Paid in full by bank transfer.",
  );
  if (!result.ok || !result.id) return result;
  const paymentId = result.id;
  after(async () => {
    await new Promise((r) => setTimeout(r, settings.undoSeconds * 1000 + 1500));
    const service = createServiceClient();
    if (!service) return;
    const { data, error } = await service.from("payments").select("status").eq("id", paymentId).maybeSingle();
    if (error) { reportError(error, { where: "quickPayAction.after", extra: { paymentId } }); return; }
    if ((data as { status: string } | null)?.status !== "succeeded") return;   // undone in the window
    await sendClaimedReceipt(service, paymentId);
    await staffInvoicePaid(service, paymentId);
  });
  return { ...result, undoSeconds: settings.undoSeconds };
}

/** Undo — the payment row is kept as `reversed`, the invoice steps back, an event is written. */
export async function undoPaymentAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ paymentId: uuid, estimateId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call("invoice_payment_undo", { p_payment_id: p.data.paymentId, p_reason: "undo" },
    { estimateId: p.data.estimateId }, "Undone — that payment no longer counts.");
}

/** Send a draft with the due date chosen in the confirm (R13: editable until now, locked after). */
export async function sendWithDueAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).merge(sendOptions.partial()).safeParse(raw);
  if (!p.success) return { ok: false, message: "Pick a due date and try again." };
  const ref = { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId };
  const due = await call("invoice_set_draft_due", { p_invoice_id: p.data.invoiceId, p_due_on: p.data.dueOn }, ref);
  if (!due.ok) return due;
  const issued = await call("invoice_issue", { p_invoice_id: p.data.invoiceId }, ref);
  if (!issued.ok) return issued;
  return finishSend(p.data.invoiceId, p.data.estimateId, "Sent", p.data.message ?? "", p.data.via ?? "email");
}

const depositInput = invoiceRef.extend({
  mode: z.enum(["percent", "fixed"]),
  // A percent, or the operator's dollar figure in whole cents — intent; the server computes and bounds.
  value: z.number().positive().max(100_000_000),
});

/** Deposit adjust on a draft — 10 / 20 / 30 / 50 % or an amount; the server computes the cents. */
export async function setDepositAction(raw: unknown): Promise<InvoicingResult> {
  const p = depositInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and try again." };
  return call("invoice_set_deposit", { p_invoice_id: p.data.invoiceId, p_mode: p.data.mode, p_value: p.data.value },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId }, "Deposit changed.");
}

/** Change a SENT, unpaid deposit: void + reissue in one transaction, then send the corrected one (⚑P6). */
export async function changeDepositAction(raw: unknown): Promise<InvoicingResult> {
  const p = depositInput.extend({ reason: z.string().max(300).default("") }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the amount and try again." };
  const changed = await call("invoice_change_amount",
    { p_invoice_id: p.data.invoiceId, p_mode: p.data.mode, p_value: p.data.value, p_reason: p.data.reason },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId });
  if (!changed.ok || !changed.id) return changed;
  return finishSend(changed.id, p.data.estimateId, "The old invoice is cancelled and the corrected one is issued", "", "email");
}

/** "Create deposit invoice" on a booked job with none — the same draft an online acceptance makes. */
export async function createDepositAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ estimateId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invoice_draft_deposit", { p_estimate_id: p.data.estimateId, p_auto: "payments" });
  if (error) { reportError(error, { where: "createDepositAction", extra: { estimateId: p.data.estimateId } }); return { ok: false, message: "Couldn't draft the deposit just now." }; }
  const r = String(data ?? "");
  revalidateAll(p.data.estimateId);
  if (r === "drafted") return { ok: true, message: "Deposit invoice drafted." };
  if (r === "exists") return { ok: true, message: "This job already has a deposit invoice." };
  const reason = r.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? `Couldn't do that (${reason || "unknown"}).` };
}

/**
 * The mockup's primary: Issue & send… — allocate the number, lock the
 * document, render the PDF (a print of the customer page), email the
 * customer their link. Each stage degrades with a plain-English message
 * rather than blocking the one before it.
 */
// Tom (25 Aug): the sender adds a personal note and chooses the channel —
// email, text or both — exactly like sending an estimate.
const sendOptions = z.object({
  message: z.string().trim().max(2000).default(""),
  via: z.enum(["email", "sms", "both"]).default("email"),
});

export async function issueAndSendAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.merge(sendOptions.partial()).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };

  const issued = await call(
    "invoice_issue",
    { p_invoice_id: p.data.invoiceId },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
  );
  if (!issued.ok) return issued;

  return finishSend(p.data.invoiceId, p.data.estimateId, "Issued", p.data.message ?? "", p.data.via ?? "email");
}

/** Re-send an already-issued invoice (records a resend event). */
export async function resendInvoiceAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.merge(sendOptions.partial()).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return finishSend(p.data.invoiceId, p.data.estimateId, "Ready", p.data.message ?? "", p.data.via ?? "email");
}

async function finishSend(
  invoiceId: string,
  estimateId: string,
  verb: string,
  personalMessage: string,
  via: "email" | "sms" | "both",
): Promise<InvoicingResult> {
  const pdfPath = await ensureInvoicePdf(invoiceId);
  const service = createServiceClient();
  if (!service) {
    revalidateAll(estimateId, invoiceId);
    return { ok: true, message: `${verb}, but sending is unavailable — copy the pay link and send it yourself.` };
  }

  const bits: string[] = [];
  let anySent = false;

  if (via !== "sms") {
    const outcome = await sendInvoiceEmail(service, invoiceId, personalMessage);
    if (outcome.status === "sent") {
      anySent = true;
      await call("invoice_send", { p_invoice_id: invoiceId, p_channel: "email" }, { estimateId, invoiceId });
      bits.push(`emailed to ${outcome.to}`);
    } else if (outcome.status === "no_recipient") bits.push("no customer email on file");
    else if (outcome.status === "not_configured") bits.push("email sending isn't switched on");
    else bits.push("the email failed to send");
  }
  if (via !== "email") {
    const outcome = await sendInvoiceSms(service, invoiceId, personalMessage);
    if (outcome.status === "sent") {
      anySent = true;
      await call("invoice_send", { p_invoice_id: invoiceId, p_channel: "sms" }, { estimateId, invoiceId });
      bits.push(`texted to ${outcome.to}`);
    } else if (outcome.status === "no_recipient") bits.push("no mobile on file");
    else if (outcome.status === "not_configured") bits.push("texting isn't switched on");
    else bits.push("the text failed to send");
  }

  revalidateAll(estimateId, invoiceId);
  const tail = pdfPath ? "" : " (PDF still generating — try the PDF button shortly.)";
  if (anySent) return { ok: true, message: `${verb} and ${bits.join(", ")}.${tail}` };
  return { ok: true, message: `${verb}, but nothing went out (${bits.join("; ")}) — copy the pay link and send it yourself.` };
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

// ---- Step 5: contractor invoices (Payables) -------------------------------

export async function approveContractorInvoiceAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ contractorInvoiceId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const result = await call(
    "contractor_invoice_approve",
    { p_id: p.data.contractorInvoiceId },
    {},
    "Approved — it's in the To-pay pile.",
  );
  if (result.ok) revalidatePath("/portal/money");
  return result;
}

const markCiPaidInput = z.object({
  contractorInvoiceId: uuid,
  reference: z.string().trim().max(200).default(""),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function markContractorInvoicePaidAction(raw: unknown): Promise<InvoicingResult> {
  const p = markCiPaidInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the reference and try again." };

  const result = await call(
    "contractor_invoice_mark_paid",
    {
      p_id: p.data.contractorInvoiceId,
      p_reference: p.data.reference,
      p_paid_on: p.data.paidOn ?? null,
    },
    {},
    "Paid recorded — remittance advice on its way to the contractor.",
  );
  if (!result.ok) return result;

  revalidatePath("/portal/money");
  // The remittance PDF + email ride behind the response (⚑16 log-driver when
  // email isn't configured) — recording the payment never waits on Chromium.
  const ciId = p.data.contractorInvoiceId;
  after(async () => {
    const service = createServiceClient();
    if (!service) return;
    await sendClaimedRemittance(service, ciId);
  });
  return result;
}

/**
 * The remittance goes exactly once, and only while the invoice is still paid:
 * `contractor_invoice_claim_remittance` stamps it first (an Undo is refused
 * from then on), then the PDF and the email (payments-merge Step 5).
 */
async function sendClaimedRemittance(service: NonNullable<ReturnType<typeof createServiceClient>>, ciId: string): Promise<void> {
  const { data, error } = await service.rpc("contractor_invoice_claim_remittance", { p_id: ciId });
  if (error) { reportError(error, { where: "sendClaimedRemittance", extra: { ciId } }); return; }
  if (data !== "ok:claimed") return;
  const path = await ensureRemittancePdf(ciId);
  const url = path ? await signedDocUrl(path, 60 * 60 * 24 * 7) : null;
  await sendRemittanceEmail(service, ciId, url);
}

// ---- Payments merge Step 5: the Contractors block (brief §4.5) ------------------
// One press, with Undo; "Approve all" / one "✓ Paid" for a contractor run the
// same RPC once per invoice, so each writes its own event. Records only — no
// money moves through the platform (existing ruling).

export type CiBatchResult = { ok: boolean; message: string; done: string[]; undoSeconds?: number };
const ciIds = z.object({ ids: z.array(uuid).min(1).max(50) });

async function eachCi(fn: string, ids: string[]): Promise<{ done: string[]; failed: string[]; reason?: string }> {
  const supabase = await createClient();
  const done: string[] = [], failed: string[] = [];
  let reason: string | undefined;
  for (const id of ids) {
    const { data, error } = await supabase.rpc(fn, { p_id: id });
    if (error) { reportError(error, { where: `eachCi.${fn}`, extra: { id } }); failed.push(id); continue; }
    if (String(data ?? "").startsWith("ok:")) done.push(id); else { failed.push(id); reason ??= String(data ?? "").replace("error:", ""); }
  }
  revalidatePath("/invoicing/payments");
  revalidatePath("/invoicing");
  revalidatePath("/portal/money");
  return { done, failed, reason };
}

const summary = (verb: string, done: number, failed: number) =>
  failed ? `${verb} ${done} of ${done + failed} — ${failed} couldn't be changed (refresh to see why).` : `${verb} ${done === 1 ? "" : `${done} `}`.trimEnd();

/** Approve, one press (or all of a contractor's). The pay-by date stays the existing rule. */
export async function approveCiQuickAction(raw: unknown): Promise<CiBatchResult> {
  const p = ciIds.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const settings = await loadPaymentsSettings();
  const { done, failed, reason } = await eachCi("contractor_invoice_approve", p.data.ids);
  // The function's own reason when it refused (8b: a draft RCTI with nothing left to invoice said only "couldn't").
  return { ok: done.length > 0, message: done.length ? summary("Approved", done.length, failed.length) : (reason && WORDING[reason]) || "Couldn't approve that — refresh and try again.", done, undoSeconds: settings.undoSeconds };
}

/** ✓ Paid, one press (or everything approved for a contractor). The remittance waits for the Undo window. */
/** 8b: one invoice may carry the bank reference and the day it was paid (the old Payables prompt). */
const payCiInput = ciIds.extend({
  reference: z.string().trim().max(120).optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export async function payCiQuickAction(raw: unknown): Promise<CiBatchResult> {
  const p = payCiInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const settings = await loadPaymentsSettings();
  const supabase = await createClient();
  const done: string[] = [], failed: string[] = [];
  for (const id of p.data.ids) {
    const { data, error } = await supabase.rpc("contractor_invoice_mark_paid", { p_id: id, p_reference: p.data.reference ?? "", p_paid_on: p.data.paidOn ?? null });
    if (error) { reportError(error, { where: "payCiQuickAction", extra: { id } }); failed.push(id); continue; }
    if (String(data ?? "").startsWith("ok:")) done.push(id); else failed.push(id);
  }
  revalidatePath("/invoicing/payments");
  revalidatePath("/invoicing");
  revalidatePath("/portal/money");
  if (done.length) {
    after(async () => {
      await new Promise((r) => setTimeout(r, settings.undoSeconds * 1000 + 1500));
      const service = createServiceClient();
      if (!service) return;
      for (const id of done) await sendClaimedRemittance(service, id);
    });
  }
  return { ok: done.length > 0, message: done.length ? summary("Marked paid", done.length, failed.length) : "Couldn't record that — refresh and try again.", done, undoSeconds: settings.undoSeconds };
}

/** Undo an Approve (within 10 minutes). */
export async function unapproveCiAction(raw: unknown): Promise<CiBatchResult> {
  const p = ciIds.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const { done, failed } = await eachCi("contractor_invoice_unapprove", p.data.ids);
  return { ok: failed.length === 0, message: failed.length ? `Undid ${done.length}; ${failed.length} couldn't be undone.` : "Undone.", done };
}

/** Undo a Paid (within 10 minutes, before the remittance has gone; never a bonus). */
export async function unpayCiAction(raw: unknown): Promise<CiBatchResult> {
  const p = ciIds.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const { done, failed } = await eachCi("contractor_invoice_unpay", p.data.ids);
  return { ok: failed.length === 0, message: failed.length ? `Undid ${done.length}; ${failed.length} couldn't be undone — the remittance may have gone.` : "Undone.", done };
}

// ---- Step 6a: cost capture (docs/briefs/claude-code-brief-cost-capture.md) --
//
// The AI reads, a human confirms, the ledger records: these actions are the
// confirm side. Amounts here are the one legitimate operator-entered figure
// (like record-bank-transfer) — zod-bounded, and the SQL bounds them again.

const JOB_COST_CATEGORIES = [
  "scaffold", "render", "carpentry", "rubbish",
  "equipment_hire", "permit", "traffic_mgmt", "other",
  // Payments merge Step 6 (20270259): supplier receipts are materials, not "other" (§6.9).
  "materials",
] as const;

const confirmIntakeInput = z.object({
  intakeId: uuid,
  destination: z.enum(["job_cost", "material_cost"]),
  woId: uuid.nullish(),
  estimateId: uuid.nullish(), // revalidation only
  vendorId: uuid.nullish(),
  vendorName: z.string().trim().max(200).default(""),
  category: z.enum(JOB_COST_CATEGORIES).default("other"),
  description: z.string().trim().max(400).default(""),
  amountExCents: z.number().int().min(0).max(100_000_000),
  gstCents: z.number().int().min(0).max(100_000_000),
  invoiceNo: z.string().trim().max(60).default(""),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  estimateLineRef: z.string().trim().max(200).default(""),
  paidWith: z.enum(["company_card", "personal", "account"]).default("account"),
});

export async function confirmIntakeAction(raw: unknown): Promise<InvoicingResult> {
  const p = confirmIntakeInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the cost details and try again." };
  return call(
    "cost_intake_confirm",
    {
      p_id: p.data.intakeId,
      p_destination: p.data.destination,
      p_wo: p.data.woId ?? null,
      p_vendor: p.data.vendorId ?? null,
      p_vendor_name: p.data.vendorName,
      p_category: p.data.category,
      p_description: p.data.description,
      p_amount_ex_cents: p.data.amountExCents,
      p_gst_cents: p.data.gstCents,
      p_invoice_no: p.data.invoiceNo,
      p_invoice_date: p.data.invoiceDate ?? null,
      p_estimate_line_ref: p.data.estimateLineRef,
      p_paid_with: p.data.paidWith,
    },
    { estimateId: p.data.estimateId ?? undefined },
    "Cost recorded with the document attached.",
  );
}

const intakeIdInput = z.object({ intakeId: uuid });

export async function rejectIntakeAction(raw: unknown): Promise<InvoicingResult> {
  const p = intakeIdInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Couldn't find that document." };
  return call("cost_intake_reject", { p_id: p.data.intakeId }, {}, "Dismissed — no cost was written.");
}

const recordJobCostInput = z.object({
  estimateId: uuid,
  woId: uuid,
  vendorId: uuid.nullish(),
  vendorName: z.string().trim().max(200).default(""),
  category: z.enum(JOB_COST_CATEGORIES).default("other"),
  description: z.string().trim().max(400).default(""),
  amountExCents: z.number().int().min(0).max(100_000_000),
  gstCents: z.number().int().min(0).max(100_000_000),
  docPath: z.string().min(1).max(400),
  estimateLineRef: z.string().trim().max(200).default(""),
  paidWith: z.enum(["company_card", "personal", "account"]).default("account"),
  invoiceNo: z.string().trim().max(60).default(""),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function recordJobCostAction(raw: unknown): Promise<InvoicingResult> {
  const p = recordJobCostInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the cost details and try again." };

  // The remediated upload path's ingest half: the staged bytes are sniffed
  // BEFORE the row is written — a signed URL was permission to store bytes,
  // never a statement of what they are. A failed sniff removes the object.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to record costs." };
  if (!isOwnReceiptPath(p.data.docPath, user.id)) {
    return { ok: false, message: "That document isn't part of this upload." };
  }
  const { data: blob } = await supabase.storage.from(COST_DOCS_BUCKET).download(p.data.docPath);
  if (!blob) return { ok: false, message: "We couldn't find that upload — try again." };
  const kind = sniffKind(new Uint8Array(await blob.arrayBuffer()));
  if (!kind) {
    await supabase.storage.from(COST_DOCS_BUCKET).remove([p.data.docPath]).catch(() => {});
    return { ok: false, message: "That doesn't look like a document — use a PDF or a photo." };
  }

  return call(
    "job_cost_record",
    {
      p_wo: p.data.woId,
      p_vendor: p.data.vendorId ?? null,
      p_vendor_name: p.data.vendorName,
      p_category: p.data.category,
      p_description: p.data.description,
      p_amount_ex_cents: p.data.amountExCents,
      p_gst_cents: p.data.gstCents,
      p_doc_path: p.data.docPath,
      p_estimate_line_ref: p.data.estimateLineRef,
      p_paid_with: p.data.paidWith,
      p_invoice_no: p.data.invoiceNo,
      p_invoice_date: p.data.invoiceDate ?? null,
    },
    { estimateId: p.data.estimateId },
    "Cost recorded with the document attached.",
  );
}

const jobCostIdInput = z.object({ jobCostId: uuid, estimateId: uuid.nullish() });

export async function approveJobCostAction(raw: unknown): Promise<InvoicingResult> {
  const p = jobCostIdInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Couldn't find that cost." };
  return call(
    "job_cost_approve",
    { p_id: p.data.jobCostId },
    { estimateId: p.data.estimateId ?? undefined },
    "Approved — it joins the to-pay list.",
  );
}

const markJobCostPaidInput = z.object({
  jobCostId: uuid,
  estimateId: uuid.nullish(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function markJobCostPaidAction(raw: unknown): Promise<InvoicingResult> {
  const p = markJobCostPaidInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the date and try again." };
  return call(
    "job_cost_mark_paid",
    { p_id: p.data.jobCostId, p_paid_on: p.data.paidOn ?? null },
    { estimateId: p.data.estimateId ?? undefined },
    "Paid recorded.",
  );
}

const assignMaterialInput = z.object({ materialCostId: uuid, woId: uuid });

export async function assignMaterialCostAction(raw: unknown): Promise<InvoicingResult> {
  const p = assignMaterialInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Pick the job first." };
  return call(
    "material_cost_assign",
    { p_id: p.data.materialCostId, p_wo: p.data.woId },
    {},
    "Matched — the cost now sits on its job.",
  );
}

// ---- 6c: contractor expenses + ask-first (staff side) ----------------------

/**
 * Employed painters (S5, ruling 13): an approved personal-card claim is paid
 * back by the office — the reimbursement queue on Payables, never an invoice
 * line. Company-card claims are job costs with nothing to pay out.
 */
export async function markReimbursedAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ expenseId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Couldn't find that claim." };
  return call("expense_mark_reimbursed", { p_id: p.data.expenseId }, {}, "Paid back — it's off the list, and the painter sees it as paid.");
}

export async function decideExpenseAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ expenseId: uuid, approve: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Couldn't find that claim." };
  const r = await call(
    "contractor_expense_decide",
    { p_id: p.data.expenseId, p_approve: p.data.approve },
    {},
    p.data.approve
      ? "Approved — it rides the contractor's next invoice as a reimbursement line."
      : "Rejected — the contractor sees why in their app.",
  );
  if (r.ok) {
    // S7: the painter is told (best-effort text; the portal already shows the decision).
    const service = createServiceClient();
    if (service) after(() => notifyExpenseDecided(service, p.data.expenseId));
  }
  return r;
}

export async function decidePreapprovalAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({
    preapprovalId: uuid,
    approve: z.boolean(),
    capCents: z.number().int().positive().max(100_000_000).optional(),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Couldn't find that request." };
  return call(
    "expense_preapproval_decide",
    { p_id: p.data.preapprovalId, p_approve: p.data.approve, p_cap_cents: p.data.capCents ?? null },
    {},
    p.data.approve ? "Approved — the contractor sees the agreed cap straight away." : "Declined.",
  );
}

/**
 * Session 3 (16 Sep 2026): pause / resume the unpaid-invoice reminders on one
 * invoice. A reason pauses (a dispute, a payment plan); an empty reason
 * resumes. Through `invoice_set_chase_hold` (20270255): UPDATE on invoices is
 * revoked from the staff session, so the old direct update never worked.
 */
export async function pauseRemindersAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ invoiceId: uuid, estimateId: uuid, reason: z.string().max(300) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the reason and try again." };
  const reason = p.data.reason.trim();
  return call("invoice_set_chase_hold", { p_invoice_id: p.data.invoiceId, p_reason: reason },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId },
    reason ? "Reminders paused for this invoice." : "Reminders resumed.");
}

// ---- Painter status Step 7 (R11, ⚑23): the hold on a Green painter's fast payment ----

export async function holdFastTermsAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ contractorInvoiceId: uuid, reason: z.string().trim().min(3).max(500) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Say why in a few words first." };
  const result = await call("contractor_invoice_hold_fast_terms", { p_id: p.data.contractorInvoiceId, p_reason: p.data.reason }, {},
    "Held — back on the default terms, never later than them. Release it when the customer's point is settled.");
  if (result.ok) { revalidatePath("/pc"); revalidatePath("/portal/money"); }
  return result;
}

export async function releaseFastTermsAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ contractorInvoiceId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const result = await call("contractor_invoice_release_fast_terms", { p_id: p.data.contractorInvoiceId }, {}, "Released — back on the Green 3-business-day terms.");
  if (result.ok) { revalidatePath("/pc"); revalidatePath("/portal/money"); }
  return result;
}


// ---- Payments merge Step 4: message follow-up (brief §4.4) -----------------------

export type PaymentTemplate = "deposit" | "reminder" | "overdue" | "received";
export type PaymentMessageDraft =
  | {
      ok: true; estimateId: string; invoiceId: string | null; who: string; phone: string | null; accountId: string | null;
      presets: { key: PaymentTemplate; label: string; text: string }[]; selected: PaymentTemplate;
    }
  | { ok: false; message: string };

const LABEL: Record<PaymentTemplate, string> = { deposit: "Deposit reminder", reminder: "Friendly reminder", overdue: "Overdue", received: "Payment received" };
const FIELD: Record<PaymentTemplate, keyof MessagingSettings> = {
  deposit: "paymentMsgDeposit", reminder: "paymentMsgReminder", overdue: "paymentMsgOverdue", received: "paymentMsgReceived",
};
/** "Monday 19 October" — a yyyy-mm-dd is a Melbourne day already, so it is formatted in UTC. */
const longDay = (ymd: string) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`)).replace(",", "");

/**
 * The messages Payments → Message pre-fills (⚑P8: Settings → Automations →
 * "Payment messages"). The template is chosen from the invoice's state —
 * Overdue is pre-selected when it is overdue — and every figure and the pay
 * link are filled HERE, on the server. Nothing is sent: the dock shows the
 * draft and a person presses Send.
 */
export async function paymentMessageDraftAction(raw: unknown): Promise<PaymentMessageDraft> {
  const p = z.object({ estimateId: uuid, invoiceId: uuid.optional() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const supabase = await createClient();
  const [est, wo, inv, settings] = await Promise.all([
    supabase.from("estimates").select("id, title, accepted_name, account_id, job_address:sent_snapshot->>jobAddress, contact:builder_state->contact").eq("id", p.data.estimateId).maybeSingle(),
    supabase.from("work_orders").select("start_date").eq("estimate_id", p.data.estimateId).maybeSingle(),
    supabase.from("invoices").select("id, estimate_id, kind, status, number, total_inc_cents, due_on, issued_on, created_at, token").eq("estimate_id", p.data.estimateId),
    supabase.from("settings").select("key, value").eq("key", MESSAGING_KEY),
  ]);
  const failed = est.error ?? wo.error ?? inv.error ?? settings.error;
  if (failed) { reportError(failed, { where: "paymentMessageDraftAction", extra: { estimateId: p.data.estimateId } }); return { ok: false, message: "Couldn't load this job just now." }; }
  if (!est.data) return { ok: false, message: "That job no longer exists." };

  const e = est.data as { title: string | null; accepted_name: string | null; account_id: string | null; job_address: string | null; contact: { first_name?: string; phone?: string } | null };
  type InvRow = { id: string; estimate_id: string; kind: JobMoneyInvoice["kind"]; status: InvoiceStatus; number: string | null; total_inc_cents: number; due_on: string | null; issued_on: string | null; created_at: string; token: string };
  const invoices = ((inv.data ?? []) as InvRow[]).filter((i) => i.status !== "void" && i.status !== "written_off");
  const asJob = (i: InvRow): JobMoneyInvoice => ({ id: i.id, estimateId: i.estimate_id, kind: i.kind, status: i.status, totalIncCents: i.total_inc_cents, dueOn: i.due_on, issuedOn: i.issued_on, number: i.number, createdAt: i.created_at });
  const target = p.data.invoiceId ? invoices.find((i) => i.id === p.data.invoiceId) ?? null : null;
  if (p.data.invoiceId && !target) return { ok: false, message: "That invoice isn't on this job." };

  let payments: DerivePayment[] = [];
  if (target) {
    const { data, error } = await supabase.from("payments").select("invoice_id, amount_cents, status, paid_on").eq("invoice_id", target.id);
    if (error) { reportError(error, { where: "paymentMessageDraftAction.payments" }); return { ok: false, message: "Couldn't load this job just now." }; }
    payments = ((data ?? []) as { invoice_id: string; amount_cents: number; status: string; paid_on: string | null }[])
      .map((x) => ({ invoiceId: x.invoice_id, amountCents: x.amount_cents, status: x.status, paidOn: x.paid_on }));
  }

  const messaging: MessagingSettings = { ...DEFAULT_MESSAGING, ...(((settings.data ?? [])[0] as { value?: Partial<MessagingSettings> } | undefined)?.value ?? {}) };
  const address = (e.job_address || e.title || "your home").split(",")[0].trim();
  const first = (e.contact?.first_name || (e.accepted_name ?? "").split(/\s+/)[0] || "").trim();
  const startDate = (wo.data as { start_date: string | null } | null)?.start_date ?? null;
  const owing = target ? invoiceBalanceCents(asJob(target), payments) : 0;
  const vars = {
    first_name: first || "there",
    amount: fmt2(Math.max(owing, 0)),
    address,
    due_date: target?.due_on ? longDay(target.due_on) : "receipt",
    start_date: startDate ? longDay(startDate) : "the agreed start date",
    // The token link only opens an issued invoice: a draft gets no link until it is sent.
    pay_link: target && target.status !== "draft" ? `${siteUrl()}/i/${target.token}` : "",
  };

  const keys: PaymentTemplate[] = [];
  if (target && owing > 0) {
    keys.push(slotOf(asJob(target), invoices.map(asJob)) === "deposit" ? "deposit" : "reminder", "overdue");
  }
  keys.push("received");
  const overdue = !!target && invoiceIsOverdue(asJob(target), payments, new Date());
  const presets = keys.map((k) => ({ key: k, label: LABEL[k], text: renderTemplate(String(messaging[FIELD[k]] ?? ""), vars).replace(/\n{3,}/g, "\n\n").trim() }));
  return {
    ok: true, estimateId: p.data.estimateId, invoiceId: target?.id ?? null,
    who: [e.accepted_name || "Customer", address].filter(Boolean).join(" · "),
    phone: e.contact?.phone ?? null, accountId: e.account_id,
    presets, selected: overdue ? "overdue" : keys[0],
  };
}

// ---- Payments merge Step 6: the Materials block (brief §4.6) -------------------
// Confirm = checked and approved in one press (⚑P9 default, Settings
// `confirmApproves`). Delete is the existing reject (or a cost's 'void'),
// reversible with Restore; nothing is hard-deleted and the document is kept.
// Paid per supplier with Undo (⚑P10). Records only — no money moves.

const matRef = z.object({ kind: z.enum(["intake", "cost"]), id: uuid });

async function eachRpc(calls: Array<{ fn: string; args: Record<string, unknown> }>): Promise<{ done: number; failed: number; firstError: string | null }> {
  const supabase = await createClient();
  let done = 0, failed = 0, firstError: string | null = null;
  for (const c of calls) {
    const { data, error } = await supabase.rpc(c.fn, c.args);
    if (error) { reportError(error, { where: `materials.${c.fn}` }); failed += 1; firstError ??= error.message; continue; }
    const r = String(data ?? "");
    if (r.startsWith("ok:")) done += 1; else { failed += 1; firstError ??= WORDING[r.replace("error:", "")] ?? r; }
  }
  revalidatePath("/invoicing/payments");
  revalidatePath("/invoicing");
  return { done, failed, firstError };
}
const batchResult = (r: { done: number; failed: number; firstError: string | null }, ok: string): CiBatchResult =>
  r.done && !r.failed ? { ok: true, message: ok, done: [] }
  : r.done ? { ok: true, message: `${ok} ${r.failed} couldn't be done: ${r.firstError ?? "refresh and try again"}.`, done: [] }
  : { ok: false, message: r.firstError ?? "That didn't work — refresh and try again.", done: [] };

/** Confirm one or many documents onto their jobs (or the job picked) — and approve them (⚑P9). */
export async function confirmMaterialsAction(raw: unknown): Promise<CiBatchResult> {
  const p = z.object({ ids: z.array(uuid).min(1).max(50), workOrderId: uuid.optional() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const supabase = await createClient();
  const { data: rows, error } = await supabase.from("settings").select("key, value").eq("key", "invoicing");
  if (error) reportError(error, { where: "confirmMaterialsAction.settings", bestEffort: true });
  const v = ((rows ?? [])[0] as { value?: { confirmApproves?: unknown } } | undefined)?.value;
  const approve = typeof v?.confirmApproves === "boolean" ? v.confirmApproves : true;
  const r = await eachRpc(p.data.ids.map((id) => ({ fn: "cost_intake_confirm_materials", args: { p_id: id, p_wo: p.data.workOrderId ?? null, p_approve: approve } })));
  return batchResult(r, approve ? "Confirmed and approved." : "Confirmed — waiting for approval.");
}

/** Not for a job — overhead, by choice; it leaves the to-match queue (§6.8). */
export async function notForJobAction(raw: unknown): Promise<CiBatchResult> {
  const p = z.object({ id: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  return batchResult(await eachRpc([{ fn: "cost_intake_not_for_job", args: { p_id: p.data.id } }]), "Marked as not for a job.");
}

/** Delete (reversible): a document → reject; a cost waiting for approval → void. The document stays. */
export async function deleteMaterialAction(raw: unknown): Promise<CiBatchResult> {
  const p = matRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  return batchResult(await eachRpc([{ fn: p.data.kind === "intake" ? "cost_intake_reject" : "job_cost_void", args: { p_id: p.data.id } }]), "Deleted. It no longer counts anywhere.");
}

export async function restoreMaterialAction(raw: unknown): Promise<CiBatchResult> {
  const p = matRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  return batchResult(await eachRpc([{ fn: p.data.kind === "intake" ? "cost_intake_restore" : "job_cost_restore", args: { p_id: p.data.id } }]), "Restored.");
}

export async function approveMaterialsAction(raw: unknown): Promise<CiBatchResult> {
  const p = z.object({ ids: z.array(uuid).min(1).max(100) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  return batchResult(await eachRpc(p.data.ids.map((id) => ({ fn: "job_cost_approve", args: { p_id: id } }))), "Approved.");
}

/** ✓ Paid for a supplier — every approved invoice in one press (⚑P10), with Undo. */
export async function paySupplierAction(raw: unknown): Promise<CiBatchResult> {
  const p = z.object({ ids: z.array(uuid).min(1).max(100) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  const settings = await loadPaymentsSettings();
  const r = await eachRpc(p.data.ids.map((id) => ({ fn: "job_cost_mark_paid", args: { p_id: id, p_paid_on: null } })));
  return { ...batchResult(r, "Marked paid."), done: r.failed ? [] : p.data.ids, undoSeconds: settings.undoSeconds };
}

export async function unpaySupplierAction(raw: unknown): Promise<CiBatchResult> {
  const p = z.object({ ids: z.array(uuid).min(1).max(100) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong.", done: [] };
  return batchResult(await eachRpc(p.data.ids.map((id) => ({ fn: "job_cost_unpay", args: { p_id: id } }))), "Undone.");
}

/** View: a short-lived link to the ORIGINAL document, looked up by row — never a path from the browser. */
export async function materialDocAction(raw: unknown): Promise<{ ok: true; url: string | null; isImage: boolean } | { ok: false; message: string }> {
  const p = matRef.safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  const supabase = await createClient();
  const { data, error } = p.data.kind === "intake"
    ? await supabase.from("cost_intake").select("path:raw_doc_path").eq("id", p.data.id).maybeSingle()
    : await supabase.from("job_costs").select("path:doc_path").eq("id", p.data.id).maybeSingle();
  if (error) { reportError(error, { where: "materialDocAction" }); return { ok: false, message: "Couldn't open the document just now." }; }
  const path = (data as { path: string | null } | null)?.path ?? null;
  if (!path) return { ok: true, url: null, isImage: false };
  const { data: signed, error: signErr } = await supabase.storage.from(COST_DOCS_BUCKET).createSignedUrl(path, 600);
  if (signErr) { reportError(signErr, { where: "materialDocAction.sign", extra: { path } }); return { ok: false, message: "Couldn't open the document just now." }; }
  return { ok: true, url: signed?.signedUrl ?? null, isImage: /\.(jpe?g|png|webp|heic|gif)$/i.test(path) };
}


// ---- Payments merge Step 7: the job panel (brief §4.7) --------------------------

/** The due date on a draft — editable until it is sent, locked after (R13). */
export async function setDraftDueAction(raw: unknown): Promise<InvoicingResult> {
  const p = invoiceRef.extend({ dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Pick a date." };
  return call("invoice_set_draft_due", { p_invoice_id: p.data.invoiceId, p_due_on: p.data.dueOn },
    { estimateId: p.data.estimateId, invoiceId: p.data.invoiceId }, "Due date changed.");
}

/**
 * Redraft a draft final that was worked out before an earlier invoice on the
 * job was issued (§6.3). `invoice_redraft_final` (20270260) is staff-only and
 * refuses when there is no draft final; the figures are the function's.
 */
export async function redraftFinalAction(raw: unknown): Promise<InvoicingResult> {
  const p = z.object({ estimateId: uuid }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Something went wrong." };
  return call("invoice_redraft_final", { p_estimate_id: p.data.estimateId }, { estimateId: p.data.estimateId },
    "Final invoice drafted again from what is left to invoice.");
}
