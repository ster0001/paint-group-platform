"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  sendOfferInput,
  withdrawOfferInput,
  reassignOfferInput,
  moveBookingInput,
  blockOutInput,
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
};

const ERROR_WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  not_issued: "Issue the work order before offering it.",
  contractor_suspended: "That contractor's access is suspended — restore it first.",
  not_offerable: "That contractor has no current, verified insurance certificate — check their paperwork on the Contractors page before offering them work.",
  contractor_not_found: "That contractor no longer exists.",
  work_order_not_found: "That job no longer exists.",
  no_start_date: "Pick a start date.",
};

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
      message: CONFLICT_WORDING[actual] ?? "This has changed since the page loaded — refresh.",
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
  return run("send_offer", {
    p_work_order_id: v.workOrderId,
    p_contractor_id: v.contractorId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_note: v.note,
  });
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
  return run("reassign_offer", {
    p_offer_id: v.offerId,
    p_new_contractor_id: v.newContractorId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_expected_state: v.expectedState,
  });
}

export async function moveBookingAction(raw: unknown): Promise<ActionResult> {
  const parsed = moveBookingInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return run("move_booking", {
    p_offer_id: v.offerId,
    p_start: v.startDate,
    p_end: v.endDate ?? null,
    p_expected_state: v.expectedState,
  });
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
