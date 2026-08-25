"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WO_STAGES } from "@/lib/workorder/stages";
import { seedRowsFromDoc } from "@/lib/workorder/surfaces";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { humaniseGate } from "@/lib/workorder/gateText";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deliverCustomerUpdate } from "@/lib/workorder/sendUpdate";
import { melbourneDate } from "@/lib/workorder/console";

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

/**
 * Ruling 3 (addendum): work had started on removed scope, so the pay deduction
 * is set BY A PERSON, never computed. Dollars in, integer cents to the RPC.
 */
export async function setVariationDeduction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    variationId: uuid,
    amountDollars: z.number().min(0).max(50_000),
    note: z.string().trim().max(500).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Enter the deduction as a dollar figure." };
  return call("wo_set_variation_deduction", {
    p_variation_id: parsed.data.variationId,
    p_cents: Math.round(parsed.data.amountDollars * 100),
    p_note: parsed.data.note,
  }, "Deduction set — the contractor sees it on their job page.");
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
  const sent = await call("wo_send_update", { p_update_id: parsed.data.updateId }, "Sent — email and text on their way.");
  if (sent.ok) {
    // The record is written; DELIVERY rides behind the response (Tom, 25 Aug:
    // updates were recorded as sent but nobody ever received anything).
    const updateId = parsed.data.updateId;
    after(async () => {
      const service = createServiceClient();
      if (service) await deliverCustomerUpdate(service, updateId, [], "both");
    });
  }
  return sent;
}

/**
 * Tom (25 Aug): push an update to the client straight from the job page —
 * the text and the chosen site photos, emailed and texted with the link to
 * their own job page. Draft → approve → send through the existing RPCs
 * (nothing unapproved can ever go), then delivery behind the response.
 */
export async function sendCustomerUpdateAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    workOrderId: uuid,
    body: z.string().trim().min(1).max(4000),
    photoIds: z.array(uuid).max(8).default([]),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Write the update first." };

  const supabase = await createClient();
  const today = melbourneDate(new Date());
  const drafted = await supabase.rpc("wo_draft_update", {
    p_work_order_id: parsed.data.workOrderId,
    p_for_date: today,
    p_text: parsed.data.body,
  });
  const draftedStr = String(drafted.data ?? "");
  if (drafted.error || !draftedStr.startsWith("ok:")) {
    return { ok: false, message: drafted.error?.message ?? draftedStr.replace("error:", "").replace(/_/g, " ") };
  }
  const updateId = draftedStr.slice(3);

  const approved = await supabase.rpc("wo_approve_update", {
    p_update_id: updateId, p_final_text: parsed.data.body,
  });
  if (approved.error || !String(approved.data ?? "").startsWith("ok")) {
    return { ok: false, message: "Couldn't approve the update — is it already sent for today?" };
  }

  const sent = await call("wo_send_update", { p_update_id: updateId },
    "Update sent — email and text with the photos are on their way.");
  if (sent.ok) {
    const photoIds = parsed.data.photoIds;
    after(async () => {
      const service = createServiceClient();
      if (service) await deliverCustomerUpdate(service, updateId, photoIds, "both");
    });
  }
  return sent;
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

export type QaResult = PcResult & { to?: "walkthrough" | "closed" };

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
  if (s.startsWith("ok:pass:closed")) {
    return { ok: true, to: "closed", message: `Passed — all checks clear. No walkthrough on this job, so it's closed: invoice stage.${thin}` };
  }
  if (s.startsWith("ok:pass:gate:")) {
    const why = s.slice("ok:pass:gate:".length).replace(/:thin_record$/, "");
    return { ok: true, message: `Passed — but the handover can't go yet: ${humaniseGate(why)}${thin}` };
  }
  return { ok: true, message: `Passed — another check is still to log before sign-off.${thin}` };
}

/** The job-level "quality check required" flag (Tom, 23 Aug). */
export async function setQaRequired(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, required: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_set_qa_required", { p_work_order_id: parsed.data.workOrderId, p_required: parsed.data.required },
    parsed.data.required ? "Quality check scheduled for this job." : "Flag cleared.");
}

/** "Walkthrough not required" on a job — it closes after finish (+ QA). */
export async function setWalkthroughRequired(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, required: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_set_walkthrough_required", { p_work_order_id: parsed.data.workOrderId, p_required: parsed.data.required },
    parsed.data.required ? "Walkthrough required again." : "No walkthrough — the job will close once it's finished and checked.");
}

/** Close a "walkthrough not required" job from prep / quality check (invoice stage). */
export async function closeWithoutWalkthrough(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const r = await call("wo_close_without_walkthrough", { p_work_order_id: parsed.data.workOrderId },
    "Closed — invoice stage. Report frozen, warranty started.");
  if (!r.ok && r.message.startsWith("gate:")) return { ok: false, message: humaniseGate(r.message.slice(5)) };
  if (!r.ok && r.message === "walkthrough required") return { ok: false, message: "This job has a walkthrough — send the pack instead." };
  return r;
}

/** A mid-job quality check, on top of the standard final (Tom, 23 Aug). */
export async function addQaCheck(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_add_qa_check", { p_work_order_id: parsed.data.workOrderId, p_date: parsed.data.date }, "Mid-job check added.");
}

/**
 * Reopen a closed job for sign-off (Tom, 23 Aug): something picked up within
 * days of signing. Back to Walkthrough, unsigned; the customer signs again.
 */
export async function reopenSignoff(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, reason: z.string().max(500).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const r = await call("wo_reopen_signoff", { p_work_order_id: parsed.data.workOrderId, p_reason: parsed.data.reason },
    "Reopened — back at Walkthrough. The customer's link can sign again once it's put right.");
  if (!r.ok && r.message.startsWith("gate:")) return { ok: false, message: humaniseGate(r.message.slice(5)) };
  return r;
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
    // Confirmed with the client at booking (Tom, 25 Aug) — feeds the
    // reminder automations later.
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
    note: z.string().max(500).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const v = parsed.data;
  const r = await call("wo_book_walkthrough",
    { p_work_order_id: v.workOrderId, p_kind: v.kind, p_date: v.date, p_time: v.time, p_note: v.note },
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

/** Staff standing with the customer: the on-device walkthrough from our phone. */
export async function staffStartWalkthrough(raw: unknown): Promise<PcResult & { url?: string }> {
  const parsed = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_start_walkthrough_mode", { p_work_order_id: parsed.data.workOrderId });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) return { ok: true, url: `/s/${s.slice(3)}`, message: "Walkthrough open on this device." };
  if (s === "error:not_at_walkthrough") return { ok: false, message: "The job isn't at the walkthrough stage yet." };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}

/**
 * Staff record the sign-off from our side (Tom, 23 Aug): the customer approved
 * in person / on the phone / on paper. Approves the outstanding areas on their
 * behalf, signs, warranty + report + invoice stub + close as for any signing.
 */
export async function staffSign(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    workOrderId: uuid, name: z.string().trim().min(1).max(120), note: z.string().max(1000).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "The customer's name is needed." };
  const r = await call("wo_staff_sign",
    { p_work_order_id: parsed.data.workOrderId, p_name: parsed.data.name, p_note: parsed.data.note },
    "Signed off and closed — warranty started, report frozen.");
  if (!r.ok && r.message.startsWith("areas outstanding")) {
    return { ok: false, message: "Some areas are flagged by the customer — settle those first." };
  }
  return r;
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
export async function confirmPrepStaff(raw: unknown): Promise<PcResult & { to?: "qa" | "walkthrough" | "closed" }> {
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
  if (s === "ok:qa" || s === "ok:walkthrough" || s === "ok:closed") {
    revalidatePath("/pc"); revalidatePath("/pc/flow");
    return {
      ok: true,
      to: s === "ok:qa" ? "qa" : s === "ok:closed" ? "closed" : "walkthrough",
      message: s === "ok:qa"
        ? "Prep confirmed — quality check next. The sign-off date gets booked once it passes."
        : s === "ok:closed"
          ? "Prep confirmed — no walkthrough on this job, so it's closed: invoice stage."
          : "Prep confirmed — the pack is with the customer, sign-off is running.",
    };
  }
  if (s.startsWith("error:gate:")) return { ok: false, message: humaniseGate(s.slice("error:gate:".length)) };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") };
}


/** Tom (25 Aug): close off an actioned card. Permanent per card key —
 *  the dismissal is itself data (a wo_event), never a UI-only hide. */
export async function dismissCard(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ workOrderId: uuid, cardKey: z.string().min(1).max(120) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  return call("wo_dismiss_card", {
    p_work_order_id: parsed.data.workOrderId,
    p_key: parsed.data.cardKey,
  }, "Closed off.");
}
