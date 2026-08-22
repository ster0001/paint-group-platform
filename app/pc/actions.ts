"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WO_STAGES } from "@/lib/workorder/stages";

/**
 * The console's own actions — the three PC surfaces the earlier steps deferred
 * to here: pricing a variation, releasing it, and approving a drafted update.
 * Each is a thin translation over an RPC; no rule lives in this file.
 */

export type PcResult = { ok: true; message?: string } | { ok: false; message: string };

const uuid = z.string().uuid();

async function call(fn: string, args: Record<string, unknown>, okWording?: string): Promise<PcResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("ok:") || s === "ok") {
    revalidatePath("/pc");
    revalidatePath("/pc/flow");
    revalidatePath("/pc/updates");
    return { ok: true, message: okWording };
  }
  const reason = s.replace("error:", "");
  if (reason.startsWith("standards_outstanding:")) {
    const n = reason.split(":")[1];
    return { ok: false, message: `Look at all the standards first — ${n} still unticked.` };
  }
  return { ok: false, message: reason.replace(/_/g, " ") };
}

export async function releaseVariation(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ variationId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_release_variation", { p_variation_id: parsed.data.variationId },
    "Released — it's with the contractor now.");
}

export async function approveUpdate(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ updateId: uuid, text: z.string().max(4000).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_approve_update",
    { p_update_id: parsed.data.updateId, p_final_text: parsed.data.text ?? null }, "Approved.");
}

export async function approveAndSendUpdate(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ updateId: uuid, text: z.string().max(4000).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const approved = await approveUpdate(parsed.data);
  if (!approved.ok) return approved;
  return call("wo_send_update", { p_update_id: parsed.data.updateId }, "Sent.");
}

/**
 * Move a job to its next stage.
 *
 * Every gate refusal comes back as `error:gate:<plain english>`, so the console
 * can say "3 pre-start items still to tick" rather than a code. The stage
 * machine decides whether the move is legal and whether it is ready; this only
 * asks, and reports.
 */
export async function advanceStage(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, to: z.enum(WO_STAGES) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_advance_stage", {
    p_work_order_id: parsed.data.workOrderId, p_to: parsed.data.to, p_meta: {},
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc"); revalidatePath("/pc/flow"); revalidatePath("/portal/jobs");
    return { ok: true };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: s.slice("error:gate:".length) };
  if (s.startsWith("error:illegal_transition:")) {
    return { ok: false, message: "A job can't make that move from where it is." };
  }
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

/**
 * Completion prep -> walkthrough goes through wo_deliver_evidence_pack rather
 * than a bare stage move: delivering the pack is what starts the customer's
 * clock and mints their link, and doing one without the other would leave a job
 * at walkthrough with nothing for the customer to open.
 */
export async function deliverEvidencePack(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_deliver_evidence_pack", {
    p_work_order_id: parsed.data.workOrderId,
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc"); revalidatePath("/pc/flow");
    return { ok: true, message: "Sent — the customer can walk through and sign now." };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: s.slice("error:gate:".length) };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

/**
 * "They got on site today" — start a job before its booked date.
 *
 * It moves the start date to today as well. Otherwise the silent-site catch
 * would measure against a date that is no longer true, and the calendar would
 * show the job starting on a day it did not.
 */
export async function startNow(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_start_now", { p_work_order_id: parsed.data.workOrderId });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc"); revalidatePath("/pc/flow"); revalidatePath("/portal/jobs");
    return { ok: true, message: "Started, and the start date moved to today." };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: s.slice("error:gate:".length) };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

export async function reofferJob(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    offerId: uuid,
    contractorId: uuid,
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(500).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick a contractor and a start date." };

  const result = await call("wo_reoffer", {
    p_offer_id: parsed.data.offerId,
    p_contractor_id: parsed.data.contractorId,
    p_start: parsed.data.start,
    p_end: null,
    p_note: parsed.data.note,
  }, "Reoffered — and the first contractor has been told.");

  // send_offer refuses a contractor without current insurance, and that refusal
  // must not be lost on the reoffer path of all places.
  if (!result.ok && result.message.includes("offerable")) {
    return { ok: false, message: "That contractor isn't compliant — their insurance needs to be current." };
  }
  return result;
}

export async function tickChecklistItem(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ itemId: uuid, done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_checklist_item", {
    p_item_id: parsed.data.itemId, p_done: parsed.data.done,
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc");
    revalidatePath("/pc/flow");
    return { ok: true };
  }
  // The two refusals worth explaining rather than reporting as codes.
  if (s === "error:colours_first") {
    return { ok: false, message: "Confirm the colour schedule first — the paint order depends on it." };
  }
  if (s.startsWith("error:derived:")) {
    return {
      ok: false,
      message: s.includes("colours")
        ? "This ticks itself once every colour on the job sheet is confirmed."
        : "This ticks itself once the QA checks are scheduled.",
    };
  }
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

export async function tickQaItem(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ itemId: uuid, done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_tick_qa_item", { p_item_id: parsed.data.itemId, p_done: parsed.data.done });
}

export async function recordQa(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    checkId: uuid,
    result: z.enum(["pass", "fail"]),
    notes: z.string().max(2000).default(""),
    rectify: z.array(z.object({ heading: z.string().max(120), label: z.string().max(300) })).default([]),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_record_qa", {
    p_check_id: parsed.data.checkId, p_result: parsed.data.result,
    p_notes: parsed.data.notes, p_rectify: parsed.data.rectify,
  }, parsed.data.result === "pass" ? "Passed." : "Failed — rectification is on the painter's list.");
}
