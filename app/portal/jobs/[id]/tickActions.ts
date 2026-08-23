"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type PrepResult = { ok: true } | { ok: false; message: string };

/**
 * Ticking a completion-prep item. The rules are the RPC's; this only turns its
 * answer into something worth reading on a phone.
 */
export async function tickPrepItem(raw: unknown): Promise<PrepResult> {
  const parsed = z.object({ itemId: z.string().uuid(), done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_checklist_item", {
    p_item_id: parsed.data.itemId, p_done: parsed.data.done,
  });
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that just now." };
}

/**
 * Answering a prep QUESTION (Tom, 23 Aug): rubbish / equipment for collection
 * are yes/no — a yes on rubbish prompts the office, a yes on equipment needs
 * the list — and the customer note is free text. The RPC holds the rules.
 */
export async function answerPrepItem(raw: unknown): Promise<PrepResult> {
  const parsed = z.object({
    itemId: z.string().uuid(),
    answer: z.enum(["yes", "no"]).optional(),
    note: z.string().max(2000).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_answer_checklist_item", {
    p_item_id: parsed.data.itemId, p_answer: parsed.data.answer ?? null, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  if (s === "error:list_required") return { ok: false, message: "Type what needs collecting first, then press Yes." };
  if (s === "error:bad_answer") return { ok: false, message: "Pick Yes or No." };
  return { ok: false, message: "Couldn't save that just now." };
}

export type NoteResult = { ok: true } | { ok: false; message: string };

/**
 * A note from site. It lands on the job's own event log rather than a separate
 * inbox, so the office reads it beside the ticks and photos that surround it.
 */
export async function addJobNote(raw: unknown): Promise<NoteResult> {
  const parsed = z.object({
    workOrderId: z.string().uuid(),
    note: z.string().trim().min(3).max(2000),
    area: z.string().max(120).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Write a little more and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_add_note", {
    p_work_order_id: parsed.data.workOrderId,
    p_note: parsed.data.note,
    p_area: parsed.data.area,
  });
  if (error) return { ok: false, message: "Couldn't send that — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) { revalidatePath("/portal/jobs"); revalidatePath("/pc"); return { ok: true }; }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't send that note." };
}

export type CrewLinkResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Mint (or rotate) the crew link for a job. The RPC checks the caller IS the
 * assigned contractor; rotating kills the old link — that is the point of
 * rotating, so the confirm lives in the UI, not here.
 */
export async function getCrewLink(raw: unknown): Promise<CrewLinkResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), rotate: z.boolean().default(false) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_crew_token", {
    p_work_order_id: parsed.data.workOrderId, p_rotate: parsed.data.rotate,
  });
  if (error) {
    // The RPC not existing yet reads as a missing function — say something
    // human rather than PostgREST's error string.
    return { ok: false, message: "Crew links aren't switched on yet — ask the office." };
  }

  const s = String(data ?? "");
  if (s.startsWith("ok:")) return { ok: true, url: `/crew/${s.slice(3)}` };
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  if (s === "error:not_issued") return { ok: false, message: "This job sheet hasn't been issued yet." };
  return { ok: false, message: "Couldn't get the link just now." };
}

export type WalkthroughModeResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Mode A: open the customer's walkthrough view inside this contractor's visit.
 * The RPC checks assignment, stage and a booked final; the session dies in two
 * hours. What comes back is the SAME /s view the customer's own link serves.
 */
export async function startWalkthroughMode(raw: unknown): Promise<WalkthroughModeResult> {
  const parsed = z.object({ workOrderId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_start_walkthrough_mode", {
    p_work_order_id: parsed.data.workOrderId,
  });
  if (error) return { ok: false, message: "Walkthrough Mode isn't switched on yet — ask the office." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) return { ok: true, url: `/s/${s.slice(3)}` };
  if (s === "error:not_at_walkthrough") return { ok: false, message: "The job isn't at the walkthrough stage yet." };
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't start the walkthrough just now." };
}

export type FinishResult =
  | { ok: true; to: "qa" | "walkthrough" }
  | { ok: false; message: string };

/**
 * "I'm done" — the painter finishes their own job. The SERVER routes it:
 * quality checks due → qa (with the notice event), none → completion prep.
 * The same stage gates apply as any advance; this never picks for the painter.
 */
export async function contractorFinish(raw: unknown): Promise<FinishResult> {
  const parsed = z.object({ workOrderId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_contractor_finish", {
    p_work_order_id: parsed.data.workOrderId,
  });
  if (error) return { ok: false, message: "Couldn't finish up just now — check your signal and try again." };

  // completion_prep is invisible now (Tom, 23 Aug): finishing and confirming
  // are ONE press. The finish moves through the hidden stage; the confirm
  // routes it — qa when a check is due, otherwise the pack goes out. A job
  // already sitting at the hidden stage (staff moved it) skips straight to
  // the confirm.
  const s = String(data ?? "");
  if (s.startsWith("error:gate:")) return { ok: false, message: s.slice("error:gate:".length) };
  if (!s.startsWith("ok:") && s !== "error:not_in_progress") {
    return { ok: false, message: "Couldn't finish up just now." };
  }

  const { data: routed, error: routeError } = await supabase.rpc("wo_contractor_confirm_prep", {
    p_work_order_id: parsed.data.workOrderId,
  });
  revalidatePath("/portal/jobs");
  if (routeError) return { ok: false, message: "Couldn't finish up just now — check your signal and try again." };
  const r = String(routed ?? "");
  if (r === "ok:qa") return { ok: true, to: "qa" };
  if (r === "ok:walkthrough") return { ok: true, to: "walkthrough" };
  if (r.startsWith("error:gate:")) return { ok: false, message: r.slice("error:gate:".length) };
  return { ok: false, message: "Couldn't finish up just now." };
}

/**
 * The painter moves the finish / walkthrough date (Tom, 23 Aug): the booking's
 * end moves on the calendar and the final walkthrough is re-booked to that day.
 */
export async function setFinishDate(raw: unknown): Promise<PrepResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_contractor_set_finish_date", {
    p_work_order_id: parsed.data.workOrderId, p_date: parsed.data.date,
  });
  if (error) return { ok: false, message: "Couldn't move the date — check your signal and try again." };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) { revalidatePath("/portal/jobs"); revalidatePath("/portal/calendar"); return { ok: true }; }
  if (s === "error:before_start") return { ok: false, message: "That's before the job starts — pick a later day." };
  if (s === "error:no_booking") return { ok: false, message: "This job isn't booked in yet — the office books it first." };
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't move the date just now." };
}

export type ConfirmPrepResult =
  | { ok: true; to: "qa" | "walkthrough" }
  | { ok: false; message: string };

/**
 * Prep confirmed — the SERVER routes it: quality check when one is due,
 * otherwise the pack goes to the customer and sign-off begins.
 */
export async function contractorConfirmPrep(raw: unknown): Promise<ConfirmPrepResult> {
  const parsed = z.object({ workOrderId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_contractor_confirm_prep", {
    p_work_order_id: parsed.data.workOrderId,
  });
  if (error) return { ok: false, message: "Couldn't confirm just now — check your signal and try again." };

  const s = String(data ?? "");
  revalidatePath("/portal/jobs");
  if (s === "ok:qa") return { ok: true, to: "qa" };
  if (s === "ok:walkthrough") return { ok: true, to: "walkthrough" };
  if (s.startsWith("error:gate:")) return { ok: false, message: s.slice("error:gate:".length) };
  if (s === "error:not_at_prep") return { ok: false, message: "This job isn't at prep — pull down to refresh." };
  return { ok: false, message: "Couldn't confirm just now." };
}
