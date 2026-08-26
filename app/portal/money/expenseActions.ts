"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Contractor expense actions (6c) — thin zod → RPC translations. The RPCs
 * own every rule: receipt required, category from Settings, the ask-first
 * threshold, ownership. Amounts here are the receipt's own figures.
 */

export type ExpenseResult = { ok: boolean; message?: string };

const uuid = z.string().uuid();

const WORDING: Record<string, string> = {
  not_a_contractor: "Your account isn't set up as a contractor.",
  not_yours: "That job isn't yours.",
  no_receipt: "Attach the receipt — no photo, no claim.",
  bad_amount: "Check the amounts — the GST can't exceed the total.",
  bad_category: "Pick a category from the list.",
  no_description: "Say what you need to buy.",
  already_decided: "The office has already answered that one.",
};

async function call(fn: string, args: Record<string, unknown>, ok: string): Promise<ExpenseResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: "Couldn't send that just now — try again." };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/money");
    return { ok: true, message: ok };
  }
  const reason = s.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? `Couldn't send that (${reason.replace(/_/g, " ")}).` };
}

export async function submitExpenseAction(raw: unknown): Promise<ExpenseResult> {
  const p = z.object({
    workOrderId: uuid,
    category: z.string().min(1).max(60),
    amountCents: z.number().int().positive().max(100_000_000),
    gstCents: z.number().int().min(0).max(100_000_000).default(0),
    receiptPath: z.string().min(1).max(400),
    note: z.string().trim().max(300).default(""),
    preapprovalId: uuid.optional(),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Check the claim and try again." };
  return call("contractor_expense_submit", {
    p_work_order_id: p.data.workOrderId,
    p_category: p.data.category,
    p_amount_cents: p.data.amountCents,
    p_gst_cents: p.data.gstCents,
    p_receipt_path: p.data.receiptPath,
    p_note: p.data.note,
    p_preapproval_id: p.data.preapprovalId ?? null,
  }, "Claim sent — it's with the office, and it rides your next invoice once approved.");
}

export async function requestPreapprovalAction(raw: unknown): Promise<ExpenseResult> {
  const p = z.object({
    workOrderId: uuid,
    description: z.string().trim().min(1).max(300),
    estCents: z.number().int().positive().max(100_000_000),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Say what you need and roughly what it costs." };
  return call("expense_preapproval_request", {
    p_work_order_id: p.data.workOrderId,
    p_description: p.data.description,
    p_est_cents: p.data.estCents,
  }, "Asked — the office sees it straight away, and the answer shows here.");
}
