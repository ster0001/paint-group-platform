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
  if (s === "error:no_walkthrough_booked") return { ok: false, message: "No final walkthrough is booked for today — the office books it first." };
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't start the walkthrough just now." };
}
