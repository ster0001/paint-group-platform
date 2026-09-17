"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type TimeOffResult = { ok: true; detail: string } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  not_a_painter: "Your account isn't set up as a painter yet — ask the office.",
  not_an_employee: "Contractors block days out on the calendar instead — tap a free day.",
  bad_kind: "Pick leave, an RDO, or sick.",
  bad_dates: "The last day has to be on or after the first.",
  too_long: "Ask for up to 60 days at a time.",
  in_the_past: "That's already passed — pick a day from today on.",
  sick_is_now: "A sick day is today (or yesterday if you're marking it the morning after) — for other days, ask for leave.",
  reason_too_long: "Keep the note under 300 characters.",
  overlap: "You've already asked for those days — cancel that request first if it's changed.",
  not_found: "That request no longer exists — pull down to refresh.",
  not_yours: "That request isn't yours.",
  not_a_request: "That's a blocked day, not a request.",
  already_started: "That's already started — talk to the office to change it.",
};

async function call(fn: string, args: Record<string, unknown>): Promise<TimeOffResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/calendar");
    revalidatePath("/portal");
    revalidatePath("/crm/today");
    return { ok: true, detail: s.slice(3) };
  }
  const reason = s.startsWith("error:") ? s.slice(6) : s;
  return { ok: false, message: WORDING[reason] ?? "Couldn't save that just now." };
}

/** Leave / RDO (the office approves) or a sick day (counts at once, raises Reassign on any booked day). */
export async function requestTimeOffAction(raw: unknown): Promise<TimeOffResult> {
  const parsed = z.object({
    kind: z.enum(["leave", "rdo", "sick"]),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().transform((t) => t.trim()).pipe(z.string().max(300)),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the kind and the days." };
  const d = parsed.data;
  return call("leave_request", { p_kind: d.kind, p_start: d.start, p_end: d.end, p_reason: d.reason });
}

export async function cancelTimeOffAction(raw: unknown): Promise<TimeOffResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };
  return call("leave_cancel", { p_id: parsed.data.id });
}
