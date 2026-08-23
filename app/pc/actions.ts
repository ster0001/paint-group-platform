"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WO_STAGES } from "@/lib/workorder/stages";
import { seedRowsFromDoc } from "@/lib/workorder/surfaces";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { humaniseGate } from "@/lib/workorder/gateText";

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
  if (s.startsWith("error:gate:")) return { ok: false, message: humaniseGate(s.slice("error:gate:".length)) };
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
  return deliverPack(supabase, parsed.data.workOrderId);
}

/** The pack delivery itself — shared by the Next-step button and the last QA pass. */
async function deliverPack(
  supabase: Awaited<ReturnType<typeof createClient>>, workOrderId: string,
): Promise<PcResult> {
  // §4b: the DRAFT report travels with the pack — generated here so what the
  // customer previews is exactly what they will sign. Best-effort: a draft
  // failure must not hold the pack hostage.
  await supabase.rpc("wo_generate_report_draft", { p_work_order_id: workOrderId })
    .then(() => {}, () => {});

  const { data, error } = await supabase.rpc("wo_deliver_evidence_pack", {
    p_work_order_id: workOrderId,
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc"); revalidatePath("/pc/flow");
    return { ok: true, message: "Sent — the customer can walk through and sign now." };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: humaniseGate(s.slice("error:gate:".length)) };
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
  if (s.startsWith("error:gate:")) return { ok: false, message: humaniseGate(s.slice("error:gate:".length)) };
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

/**
 * Build (or repair) a job's tick list from its own frozen job sheet.
 *
 * Jobs issued before the tick list existed have no surfaces, so the painter has
 * nothing to tick and no way to say so. Seeding is idempotent and never resets
 * state, so pressing this on a live job refreshes wording and order without
 * touching a day's work.
 */
export async function rebuildTickList(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data: wo } = await supabase
    .from("work_orders").select("wo_snapshot").eq("id", parsed.data.workOrderId).maybeSingle();

  const doc = (wo as { wo_snapshot?: WorkOrderDoc } | null)?.wo_snapshot;
  if (!doc?.areas?.length) {
    return { ok: false, message: "This job has no job sheet yet — issue it from the builder first." };
  }

  const { data, error } = await supabase.rpc("wo_seed_surfaces", {
    p_work_order_id: parsed.data.workOrderId,
    p_rows: seedRowsFromDoc(doc),
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (!s.startsWith("ok:")) return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };

  revalidatePath("/pc");
  revalidatePath("/portal/jobs");
  return { ok: true, message: "Tick list built — the painter can work it now." };
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
    return { ok: false, message: "Tick the colour schedule first — the paint order depends on it." };
  }
  if (s.startsWith("error:derived:")) {
    return {
      ok: false,
      message: "This ticks itself once the quality checks are scheduled.",
    };
  }
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

export async function tickQaItem(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ itemId: uuid, done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_tick_qa_item", { p_item_id: parsed.data.itemId, p_done: parsed.data.done });
}

export type QaResult = PcResult & { to?: "walkthrough" };

/**
 * Log a check. A FAIL sends the job back to the brushes; the LAST PASS sends
 * the pack and moves the job to Walkthrough — both inside wo_record_qa itself
 * (Tom, 23 Aug: automatic, for staff and contractor alike, wherever the pass is
 * logged). This only reads the RPC's answer back into words:
 *   ok:pass:walkthrough  → moved
 *   ok:pass:gate:<why>   → passed, but the pack can't go yet (a variation
 *                          waiting, say) — the job stays at qa and says why
 *   ok:pass              → passed, another check still to log
 */
export async function recordQa(raw: unknown): Promise<QaResult> {
  const parsed = z.object({
    checkId: uuid,
    result: z.enum(["pass", "fail"]),
    notes: z.string().max(2000).default(""),
    rectify: z.array(z.object({ heading: z.string().max(120), label: z.string().max(300) })).default([]),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_record_qa", {
    p_check_id: parsed.data.checkId, p_result: parsed.data.result,
    p_notes: parsed.data.notes, p_rectify: parsed.data.rectify,
  });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (!s.startsWith("ok:")) {
    const reason = s.replace("error:", "");
    if (reason.startsWith("standards_outstanding:")) {
      return { ok: false, message: `Look at all the standards first — ${reason.split(":")[1]} still unticked.` };
    }
    return { ok: false, message: reason.replace(/_/g, " ") };
  }
  revalidatePath("/pc"); revalidatePath("/pc/flow"); revalidatePath("/pc/updates");
  const thin = s.endsWith(":thin_record") ? " (thin photo record)" : "";
  if (s.startsWith("ok:fail")) return { ok: true, message: `Failed — rectification is on the painter's list.${thin}` };
  if (s.startsWith("ok:pass:walkthrough")) {
    return { ok: true, to: "walkthrough", message: `Passed — all checks clear. The customer has their walkthrough; sign-off is running.${thin}` };
  }
  if (s.startsWith("ok:pass:gate:")) {
    const why = s.slice("ok:pass:gate:".length).replace(/:thin_record$/, "");
    return { ok: true, message: `Passed — but the handover can't go yet: ${humaniseGate(why)}${thin}` };
  }
  return { ok: true, message: `Passed — another check is still to log before sign-off.${thin}` };
}

/** A completion-prep QUESTION answered by the office on the painter's behalf. */
export async function answerChecklistItem(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    itemId: uuid, answer: z.enum(["yes", "no"]).optional(), note: z.string().max(2000).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_answer_checklist_item", {
    p_item_id: parsed.data.itemId, p_answer: parsed.data.answer ?? null, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) { revalidatePath("/pc"); revalidatePath("/pc/flow"); return { ok: true }; }
  if (s === "error:list_required") return { ok: false, message: "List what needs collecting, then save." };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

/** "Organised" on a rubbish / equipment collection — clears the dashboard prompt. */
export async function markCollectionHandled(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ itemId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_handle_collection", { p_item_id: parsed.data.itemId }, "Organised.");
}

// ---------------------------------------------------------------------------
// §4b (v3) — walkthrough booking + the two-mode sign-off, staff side.
// The RPCs hold every rule; these validate shape and translate refusals.
// ---------------------------------------------------------------------------

export async function bookWalkthrough(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    workOrderId: uuid,
    kind: z.enum(["pre", "final"]),
    // Omitted for a final = the booking's last day on site, decided in SQL.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    note: z.string().max(500).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const v = parsed.data;
  const r = await call("wo_book_walkthrough",
    { p_work_order_id: v.workOrderId, p_kind: v.kind, p_date: v.date, p_note: v.note },
    v.kind === "final" ? "Final walkthrough booked." : "Pre-walkthrough booked.");
  if (!r.ok && r.message === "no date") {
    return { ok: false, message: "No accepted booking to take a date from — pick the day yourself." };
  }
  if (!r.ok && r.message === "qa first") {
    return { ok: false, message: "Quality check first — the final isn't booked with the customer until the checks pass." };
  }
  return r;
}

export async function setWalkthroughStatus(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    walkthroughId: uuid,
    status: z.enum(["done", "missed", "cancelled"]),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_set_walkthrough_status",
    { p_walkthrough_id: parsed.data.walkthroughId, p_status: parsed.data.status },
    parsed.data.status === "missed"
      ? "Marked missed — the customer can now be asked to sign remotely."
      : "Updated.");
}

export async function markClientUnavailable(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_mark_client_unavailable", { p_work_order_id: parsed.data.workOrderId },
    "Marked unavailable — remote sign-off is now open to them.");
}

export async function generateReportDraft(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_generate_report_draft", { p_work_order_id: parsed.data.workOrderId },
    "Draft report generated.");
}

/**
 * Staff confirm the prep from the console — the SAME routed step the painter
 * has: the server sends the job to quality check when one is due, otherwise
 * the pack goes to the customer. One button, no lane-picking.
 */
export async function confirmPrepStaff(raw: unknown): Promise<PcResult & { to?: "qa" | "walkthrough" }> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();

  // completion_prep is invisible: from in_progress this walks the hidden stage
  // and routes in one press. Already past the ticks? The finish no-ops with
  // not_in_progress and the confirm still runs.
  const { data: finished } = await supabase.rpc("wo_contractor_finish", {
    p_work_order_id: parsed.data.workOrderId,
  });
  const f = String(finished ?? "");
  if (f.startsWith("error:gate:")) return { ok: false, message: humaniseGate(f.slice("error:gate:".length)) };

  const { data, error } = await supabase.rpc("wo_contractor_confirm_prep", {
    p_work_order_id: parsed.data.workOrderId,
  });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s === "ok:qa" || s === "ok:walkthrough") {
    revalidatePath("/pc"); revalidatePath("/pc/flow");
    return {
      ok: true,
      to: s === "ok:qa" ? "qa" : "walkthrough",
      message: s === "ok:qa"
        ? "Prep confirmed — quality check next. The sign-off date gets booked once it passes."
        : "Prep confirmed — the pack is with the customer, sign-off is running.",
    };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: humaniseGate(s.slice("error:gate:".length)) };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}
