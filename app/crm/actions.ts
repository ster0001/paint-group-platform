"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildEvent, type CrmEventType } from "@/lib/crm/events";

/**
 * The Customer tab's writes. Every one goes through an RPC — the browser never
 * touches a table (the acceptance gate: browser→DB mutations across the CRM, 0)
 * — and every one leaves an event behind, because a change with no row in the
 * log makes the timeline lie.
 */

export type CrmResult = { ok: true; message: string } | { ok: false; message: string };

const uuid = z.string().uuid();

/** The four chips the mockup offers, plus the note box. */
const LOGGABLE = ["call_no_answer", "message_left", "call_connected", "note_added"] as const;
export type LoggableAction = (typeof LOGGABLE)[number];

const WORDING: Record<LoggableAction, string> = {
  call_no_answer: "Logged — called, no answer.",
  message_left: "Logged — message left.",
  call_connected: "Logged — spoke to them.",
  note_added: "Note saved.",
};

export async function logActivity(accountId: string, action: LoggableAction, text: string): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (!LOGGABLE.includes(action)) return { ok: false, message: "That isn't something we log." };
  const note = text.trim();
  if (action === "note_added" && note === "") return { ok: false, message: "A note needs some words." };

  // The payload is shaped and validated by the same builder the rest of the
  // codebase uses, so a bad write fails here rather than in the log.
  let args: ReturnType<typeof buildEvent>;
  try {
    args = buildEvent({
      type: action as CrmEventType,
      accountId,
      source: "staff",
      payload: action === "note_added" ? { body: note } : note ? { note } : {},
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That didn't look right." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_log_event", args);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/crm");
  return { ok: true, message: WORDING[action] };
}

export async function setTemperature(accountId: string, temperature: "hot" | "warm" | "cold"): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_set_temperature", { p_account_id: accountId, p_temperature: temperature });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm");
  return { ok: true, message: `Marked ${temperature}.` };
}

/** Days from today, so the caller never has to build a date. */
export async function snooze(accountId: string, days: number, reason: string): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, message: "Snooze between 1 and 365 days." };
  const until = new Date(Date.now() + days * 86_400_000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_snooze", { p_account_id: accountId, p_until: until, p_reason: reason.trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm");
  return { ok: true, message: `Out of the way for ${days} day${days === 1 ? "" : "s"}.` };
}

export async function setFollowup(accountId: string, days: number, note: string): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (!Number.isFinite(days) || days < 0 || days > 365) return { ok: false, message: "Follow up within a year." };
  const due = new Date(Date.now() + days * 86_400_000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_set_followup", { p_account_id: accountId, p_due_at: due, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm");
  return { ok: true, message: days === 0 ? "Reminder set for today." : `Reminder set for ${days} day${days === 1 ? "" : "s"} away.` };
}
