"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureInvoicePdf, ensureReceiptPdf, ensureRemittancePdf, signedDocUrl } from "@/lib/invoicing/pdf";
import { sendInvoiceEmail, sendInvoiceSms, sendReceiptEmail, sendRemittanceEmail } from "@/lib/invoicing/sendInvoice";
import { COST_DOCS_BUCKET, isOwnReceiptPath } from "@/lib/costs/store";
import { sniffKind } from "@/lib/extract/normalise";

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
    const path = await ensureRemittancePdf(ciId);
    const url = path ? await signedDocUrl(path, 60 * 60 * 24 * 7) : null;
    await sendRemittanceEmail(service, ciId, url);
  });
  return result;
}

// ---- Step 6a: cost capture (docs/briefs/claude-code-brief-cost-capture.md) --
//
// The AI reads, a human confirms, the ledger records: these actions are the
// confirm side. Amounts here are the one legitimate operator-entered figure
// (like record-bank-transfer) — zod-bounded, and the SQL bounds them again.

const JOB_COST_CATEGORIES = [
  "scaffold", "render", "carpentry", "rubbish",
  "equipment_hire", "permit", "traffic_mgmt", "other",
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
