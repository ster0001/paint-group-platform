"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reconcileForOffer } from "@/lib/gcal/sync";
import { notifyAssignment, notifyJobOffer } from "@/lib/contractor/notify";
import { sendAppointmentConfirmation } from "@/lib/workorder/appointmentEmail";
import { sendWalkthroughInvites } from "@/lib/workorder/walkthroughInvite";
import { reportError } from "@/lib/monitoring/report";
import {
  sendOfferInput,
  withdrawOfferInput,
  reassignOfferInput,
  moveBookingInput,
  blockOutInput,
  assignJobInput,
  reassignDatesInput,
  setLeadPainterInput,
  releaseAssignmentInput,
} from "@/lib/validation/booking";

/**
 * Server actions for booking money and state.
 *
 * Every one: validate with zod → check the caller is staff → call a single
 * SECURITY DEFINER function that does the whole change in one transaction.
 *
 * None of them accepts an amount. The contractor's payment is derived inside
 * the database from stored pricing data, so there is nothing for a client to
 * forge — and the client role has no INSERT/UPDATE on booking_offers anyway,
 * so calling supabase-js directly is refused too.
 */

/** What every action returns. `conflict` means the row moved on — say "refresh". */
export type ActionResult =
  | { ok: true; state: string }
  | { ok: false; kind: "conflict"; actualState: string; message: string }
  | { ok: false; kind: "invalid"; message: string; fieldErrors?: Record<string, string[]> }
  | { ok: false; kind: "error"; message: string };

const CONFLICT_WORDING: Record<string, string> = {
  already_offered: "This job already has a live offer out. Refresh to see it.",
  accepted: "The contractor has already accepted this. Refresh to see the booking.",
  declined: "The contractor has already declined this. Refresh.",
  expired: "This offer expired before the change went through. Refresh.",
  withdrawn: "This offer has already been withdrawn. Refresh.",
  cancelled: "This booking has already been cancelled. Refresh.",
  proposed: "The contractor has proposed a different date. Refresh to see it.",
  // Employed painters (Session 2)
  contractor_job: "This job is out with a contractor. Withdraw or cancel that first — a job is either a contractor's or a crew of employees', never both.",
  already_assigned: "That painter is already on this job.",
};

const ERROR_WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  not_issued: "Issue the work order before offering it.",
  contractor_suspended: "That contractor's access is suspended — restore it first.",
  not_offerable: "That contractor has no current, verified insurance certificate — check their paperwork on the Contractors page before offering them work.",
  contractor_not_found: "That contractor no longer exists.",
  work_order_not_found: "That job no longer exists.",
  no_start_date: "Pick a start date.",
  // Employed painters (Session 2)
  not_employee: "Only employed painters can be assigned. A contractor gets an offer — drop the job on their lane instead.",
  no_painters: "Pick at least one painter.",
  bad_dates: "The end date cannot be before the start date.",
  lead_not_on_job: "The lead painter has to be one of the painters on the job.",
  lead_needs_replacement: "That painter is the lead. Name another lead painter first, then take them off.",
  not_on_job: "That painter isn't on this job.",
  closed: "This job is closed.",
  released: "That painter has already been taken off the job.",
  not_found: "That assignment no longer exists.",
};

/**
 * The database names what an assignment ran into — "conflict:overlap:WO-1234"
 * or "conflict:unavailable:leave:2026-10-05" — so the office reads WHICH job
 * or WHICH kind of day, and can override with a reason if they mean it.
 */
function assignmentConflictWording(actual: string): string | null {
  const [what, ...rest] = actual.split(":");
  if (what === "overlap") return `They're already on ${rest[0] || "another job"} over those dates. Move those days, or override with a reason.`;
  if (what === "unavailable") {
    const kind = rest[0] || "other";
    const day = rest[1] ? rest[1].split("-").reverse().join("/") : "";
    const word = kind === "leave" ? "on leave" : kind === "rdo" ? "on an RDO" : kind === "sick" ? "off sick" : "blocked out";
    return `They're ${word}${day ? ` from ${day}` : ""}. Pick other days, or override with a reason.`;
  }
  return null;
}

/** Turn the database's `ok:` / `conflict:` / `error:` contract into a typed result. */
function interpret(raw: unknown): ActionResult {
  const s = String(raw ?? "");
  if (s.startsWith("ok:")) return { ok: true, state: s.slice(3) };
  if (s.startsWith("conflict:")) {
    const actual = s.slice(9);
    return {
      ok: false,
      kind: "conflict",
      actualState: actual,
      message: CONFLICT_WORDING[actual] ?? assignmentConflictWording(actual) ?? "This has changed since the page loaded — refresh.",
    };
  }
  const reason = s.startsWith("error:") ? s.slice(6) : s;
  return { ok: false, kind: "error", message: ERROR_WORDING[reason] ?? `Couldn't complete that (${reason}).` };
}

function invalid(e: z.ZodError): ActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return {
    ok: false,
    kind: "invalid",
    message: e.issues[0]?.message ?? "That input isn't valid.",
    fieldErrors,
  };
}

/** Staff-only gate. RLS and the functions enforce it too; this fails fast and clearly. */
async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { supabase, ok: profile?.role === "staff" };
}

async function run(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, ok } = await requireStaff();
  if (!ok) return { ok: false, kind: "error", message: ERROR_WORDING.not_staff };

  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, kind: "error", message: error.message };

  const result = interpret(data);
  if (result.ok) {
    revalidatePath("/pc/schedule");
    revalidatePath("/contractors");
  }
  return result;
}

// ---------------------------------------------------------------------------

export async function sendOfferAction(raw: unknown): Promise<ActionResult> {
  const parsed = sendOfferInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  // The job-level QA flag is set FIRST (it is the job's, not the offer's), so
  // whoever accepts, the check is scheduled the moment the job goes live.
  if (v.qaRequired) {
    const flagged = await run("wo_set_qa_required", { p_work_order_id: v.workOrderId, p_required: true });
    if (!flagged.ok) return flagged;
  }
  if (!v.walkthroughRequired) {
    const flagged = await run("wo_set_walkthrough_required", { p_work_order_id: v.workOrderId, p_required: false });
    if (!flagged.ok) return flagged;
  }
  const sent = await run("send_offer", {
    p_work_order_id: v.workOrderId,
    p_contractor_id: v.contractorId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_note: v.note,
  });
  // The walkthrough the sheet confirmed with the client, booked server-side in
  // the same action (Tom, 1 Sep — it used to be a client fire-and-forget that
  // could silently miss). Best-effort by ruling: a refusal (e.g. qa_first)
  // never unwinds the offer — the job page's WalkthroughCard and the console's
  // contact card catch an unbooked final.
  if (sent.ok && v.walkthroughRequired && v.walkthroughDate) {
    const { supabase } = await requireStaff();
    await supabase.rpc("wo_book_walkthrough", {
      p_work_order_id: v.workOrderId,
      p_kind: "final",
      p_date: v.walkthroughDate,
      p_time: v.walkthroughTime ?? null,
      p_note: "Confirmed with the client at booking",
    }).then(() => {}, () => {});
  }
  // "You have a job offer" — text + email to the painter (Tom, 1 Sep #2).
  if (sent.ok) {
    const service = createServiceClient();
    if (service) after(() => notifyJobOffer(service, v.workOrderId, v.contractorId));
  }
  return sent;
}

export async function withdrawOfferAction(raw: unknown): Promise<ActionResult> {
  const parsed = withdrawOfferInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return run("withdraw_offer", { p_offer_id: parsed.data.offerId, p_expected_state: parsed.data.expectedState });
}

export async function reassignOfferAction(raw: unknown): Promise<ActionResult> {
  const parsed = reassignOfferInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const r = await run("reassign_offer", {
    p_offer_id: v.offerId,
    p_new_contractor_id: v.newContractorId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_expected_state: v.expectedState,
  });
  // The OLD contractor may lose an accepted booking here — take it off their
  // Google Calendar after the response goes out. The NEW contractor gets the
  // offer text + email, same as a fresh send.
  if (r.ok) {
    after(() => reconcileForOffer(v.offerId));
    const service = createServiceClient();
    if (service) {
      after(async () => {
        const { data } = await service
          .from("booking_offers").select("work_order_id").eq("id", v.offerId).maybeSingle();
        const woId = (data as { work_order_id?: string } | null)?.work_order_id;
        if (woId) await notifyJobOffer(service, woId, v.newContractorId);
      });
    }
  }
  return r;
}

export async function moveBookingAction(raw: unknown): Promise<ActionResult> {
  const parsed = moveBookingInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const r = await run("move_booking", {
    p_offer_id: v.offerId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_expected_state: v.expectedState,
  });
  // An accepted booking's dates moved — update the contractor's Google event.
  if (r.ok) after(() => reconcileForOffer(v.offerId));
  return r;
}

// ---------------------------------------------------------------------------
// Employed painters (Session 2). An employee is ASSIGNED, never offered: the
// drop on their lane is the booking. No amount crosses the wire here either —
// there is no amount to cross; an employee's job carries none.
// ---------------------------------------------------------------------------

export async function assignJobAction(raw: unknown): Promise<ActionResult> {
  const parsed = assignJobInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (v.qaRequired) {
    const flagged = await run("wo_set_qa_required", { p_work_order_id: v.workOrderId, p_required: true });
    if (!flagged.ok) return flagged;
  }
  if (!v.walkthroughRequired && !v.addingToBookedJob) {
    const flagged = await run("wo_set_walkthrough_required", { p_work_order_id: v.workOrderId, p_required: false });
    if (!flagged.ok) return flagged;
  }
  const r = await run("assign_job", {
    p_work_order_id: v.workOrderId,
    p_painters: v.painters.map((p) => ({
      contractor_id: p.contractorId, start_date: p.startDate, end_date: p.endDate ?? p.startDate,
    })),
    p_lead_contractor_id: v.leadContractorId,
    p_override_reason: v.overrideReason || null,
  });
  if (!r.ok) return r;

  const { supabase } = await requireStaff();
  if (!v.addingToBookedJob && v.walkthroughRequired && v.walkthroughDate) {
    await supabase.rpc("wo_book_walkthrough", {
      p_work_order_id: v.workOrderId, p_kind: "final", p_date: v.walkthroughDate,
      p_time: v.walkthroughTime ?? null, p_note: "Confirmed with the client at booking",
    }).then(() => {}, () => {});
  }

  const service = createServiceClient();
  if (service) {
    after(async () => {
      // ⚑A (default): the customer is confirmed AT ASSIGNMENT — the office has
      // committed the job; the painter's Accept is visibility, never a gate.
      // Idempotent per start date, so three painters = one confirmation.
      await sendAppointmentConfirmation(service, v.workOrderId);
      await sendWalkthroughInvites(service, v.workOrderId);
      // "You're on this job — tap Accept", to each painter just added. A
      // refused read here means nobody is pinged — say so, don't render silence.
      const { data, error } = await service
        .from("wo_assignments").select("id, contractor_id")
        .eq("work_order_id", v.workOrderId).neq("status", "released")
        .in("contractor_id", v.painters.map((p) => p.contractorId));
      if (error) {
        reportError(error, { where: "assignJob.notifyRead", extra: { workOrderId: v.workOrderId } });
        return;
      }
      for (const a of (data ?? []) as { id: string }[]) await notifyAssignment(service, a.id, "assigned");
    });
  }
  revalidatePath("/pc");
  return r;
}

export async function reassignDatesAction(raw: unknown): Promise<ActionResult> {
  const parsed = reassignDatesInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const r = await run("reassign_dates", {
    p_assignment_id: v.assignmentId, p_start: v.startDate, p_end: v.endDate ?? v.startDate,
    p_override_reason: v.overrideReason || null,
  });
  // Their Accept was cleared server-side; tell them to accept again. An
  // unchanged span ("ok:unchanged") sends nothing.
  if (r.ok && r.state === "moved") {
    const service = createServiceClient();
    if (service) after(() => notifyAssignment(service, v.assignmentId, "dates_changed"));
  }
  return r;
}

export async function setLeadPainterAction(raw: unknown): Promise<ActionResult> {
  const parsed = setLeadPainterInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const r = await run("set_lead_painter", {
    p_work_order_id: parsed.data.workOrderId, p_contractor_id: parsed.data.contractorId,
  });
  if (r.ok) revalidatePath(`/pc/wo/${parsed.data.workOrderId}`);
  return r;
}

export async function releaseAssignmentAction(raw: unknown): Promise<ActionResult> {
  const parsed = releaseAssignmentInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  // Read the painter BEFORE the row is released — the notify reads the row
  // afterwards and needs to know it still exists; released rows keep their data.
  const r = await run("release_assignment", { p_assignment_id: v.assignmentId, p_reason: v.reason });
  if (r.ok && r.state === "released") {
    const service = createServiceClient();
    if (service) after(() => notifyAssignment(service, v.assignmentId, "released"));
  }
  revalidatePath("/pc");
  return r;
}

/**
 * Blocking days out carries no money and no state machine, so it stays a plain
 * validated insert under existing RLS rather than gaining a bespoke RPC.
 */
export async function blockOutAction(raw: unknown): Promise<ActionResult> {
  const parsed = blockOutInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, ok } = await requireStaff();
  if (!ok) return { ok: false, kind: "error", message: ERROR_WORDING.not_staff };

  const v = parsed.data;
  const { error } = await supabase.from("contractor_unavailability").insert({
    contractor_id: v.contractorId,
    start_date: v.startDate,
    end_date: v.endDate,
    reason: v.reason,
    source: "staff",
  });
  if (error) return { ok: false, kind: "error", message: error.message };
  revalidatePath("/pc/schedule");
  return { ok: true, state: "blocked" };
}

// ---------------------------------------------------------------------------
// Booking notes — the chase log on a job waiting for a date.
//
// Straight table writes rather than an RPC: there is no derived money or state
// machine involved, and `wo_booking_notes` is staff-only at the policy level,
// so RLS is the real guard and this is the fast, clear failure in front of it.
// ---------------------------------------------------------------------------

export async function addBookingNote(raw: unknown): Promise<ActionResult> {
  const parsed = z.object({
    workOrderId: z.string().uuid(),
    // Trimmed BEFORE the length check, so a box of spaces is caught here and
    // not by the CHECK constraint as a database error.
    note: z.string().transform((t) => t.trim()).pipe(z.string().min(1, "Write the note first.").max(2000)),
  }).safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, ok } = await requireStaff();
  if (!ok) return { ok: false, kind: "error", message: ERROR_WORDING.not_staff };

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("wo_booking_notes").insert({
    work_order_id: parsed.data.workOrderId,
    note: parsed.data.note,
    author: user?.id ?? null,
  });
  if (error) return { ok: false, kind: "error", message: error.message };

  revalidatePath("/pc/schedule");
  revalidatePath("/pc");
  return { ok: true, state: "noted" };
}

export async function deleteBookingNote(raw: unknown): Promise<ActionResult> {
  const parsed = z.object({ noteId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  const { supabase, ok } = await requireStaff();
  if (!ok) return { ok: false, kind: "error", message: ERROR_WORDING.not_staff };

  const { error } = await supabase.from("wo_booking_notes").delete().eq("id", parsed.data.noteId);
  if (error) return { ok: false, kind: "error", message: error.message };

  revalidatePath("/pc/schedule");
  revalidatePath("/pc");
  return { ok: true, state: "deleted" };
}
