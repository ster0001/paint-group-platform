"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type TimesheetResult = { ok: true; detail: string } | { ok: false; message: string };

const WORDING: Record<string, string> = {
  not_a_painter: "Your account isn't set up as a painter yet — ask the office.",
  not_an_employee: "Only employed painters clock on — contractors invoice their days.",
  no_job_today: "Nothing is booked for you today. Open the job you're on and start the day from there.",
  pick_job: "You're on more than one job today — open the one you're at and start the day from there.",
  not_your_job: "That job isn't yours.",
  already_started: "Your day is already running — finish it before starting another.",
  not_started: "No day is running. Tap Start day first.",
  too_short: "That's under a minute of work — tap Start again when you're actually on the tools.",
  bad_break: "The break has to be between 0 and 4 hours.",
};

async function call(fn: string, args: Record<string, unknown>): Promise<TimesheetResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal");
    revalidatePath("/portal/jobs");
    return { ok: true, detail: s.slice(3) };
  }
  const reason = s.startsWith("error:") ? s.slice(6) : s;
  return { ok: false, message: WORDING[reason] ?? "Couldn't save that just now." };
}

/** Start day — on the named job, or today's assigned job when none is named. */
export async function startDayAction(raw: unknown): Promise<TimesheetResult> {
  const parsed = z.object({ workOrderId: z.string().uuid().nullable().optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };
  return call("timesheet_start", { p_work_order_id: parsed.data.workOrderId ?? null });
}

/** Finish day — closes the running day with the break taken; the office approves. */
export async function finishDayAction(raw: unknown): Promise<TimesheetResult> {
  const parsed = z.object({ breakMinutes: z.number().int().min(0).max(240) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: WORDING.bad_break };
  return call("timesheet_finish", { p_break_minutes: parsed.data.breakMinutes });
}
