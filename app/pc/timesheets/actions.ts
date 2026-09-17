"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyLeaveDecided } from "@/lib/contractor/notify";
import type { PcResult } from "../actions";

/**
 * Employed painters — Session 6: the office's side of a timesheet. Thin
 * translations over the RPCs in 20270163; the rules (one labour line per
 * approval, hours × the rate on the day, no rate → refuse) live there.
 */

const WORDING: Record<string, string> = {
  not_staff: "Only staff can do that.",
  not_found: "That entry no longer exists — refresh.",
  not_submitted: "That day isn't waiting on you.",
  no_rate: "No cost rate is set for this painter — set one on the Painters screen first, then approve.",
  too_short: "That entry has no hours in it.",
  already_approved: "That day is already approved — it has posted to the job.",
  still_open: "The painter hasn't finished that day yet.",
  not_an_employee: "That painter is a contractor — their days are the offer, not a timesheet.",
  not_on_job: "That painter isn't assigned to that job.",
  bad_span: "Finish has to be after start.",
  too_long: "A day can't run past 16 hours.",
  bad_break: "The break has to be between 0 and 4 hours.",
  not_a_request: "That's a blocked day, not a request.",
};

async function call(fn: string, args: Record<string, unknown>, okWording?: string): Promise<PcResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/pc/timesheets");
    return { ok: true, message: okWording };
  }
  const reason = s.replace("error:", "");
  return { ok: false, message: WORDING[reason] ?? reason.replaceAll("_", " ") };
}

export async function approveTimesheetAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ entryId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  return call("timesheet_approve", { p_entry_id: parsed.data.entryId }, "Approved — the labour line is on the job.");
}

export async function rejectTimesheetAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    entryId: z.string().uuid(),
    reason: z.string().transform((t) => t.trim()).pipe(z.string().max(300)),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Keep the reason under 300 characters." };
  return call("timesheet_reject", { p_entry_id: parsed.data.entryId, p_reason: parsed.data.reason }, "Not approved — the painter sees why.");
}

/** A day recorded by the office (a forgotten tap, a paper sheet). Lands submitted. */
export async function recordTimesheetAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    contractorId: z.string().uuid(),
    workOrderId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    finish: z.string().regex(/^\d{2}:\d{2}$/),
    breakMinutes: z.number().int().min(0).max(240),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick the painter, the job, the day and the times." };
  const d = parsed.data;
  // Wall-clock Melbourne times → instants, with the zone's offset ON THAT DAY
  // (never a written-down +10:00 — Melbourne is +11 from October to April).
  const startedAt = melbourneInstant(d.date, d.start);
  const finishedAt = melbourneInstant(d.date, d.finish);
  return call("timesheet_record", {
    p_contractor_id: d.contractorId, p_work_order_id: d.workOrderId,
    p_started_at: startedAt, p_finished_at: finishedAt, p_break_minutes: d.breakMinutes,
  }, "Recorded — it's in the list to approve.");
}

/** The instant a Melbourne wall-clock time names, measured from the zone. */
function melbourneInstant(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asMelbourne = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(guess - (asMelbourne - guess)).toISOString();
}

/**
 * S7: approve or decline a leave / RDO request. Approval over a booked day
 * is refused with the job named (`conflict:assigned:WO-…`) — reassign first.
 * The painter is texted either way (best-effort; the calendar shows it).
 */
export async function decideLeaveAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    id: z.string().uuid(),
    approve: z.boolean(),
    note: z.string().transform((t) => t.trim()).pipe(z.string().max(300)).optional().default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Keep the note under 300 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_decide", { p_id: parsed.data.id, p_approve: parsed.data.approve, p_note: parsed.data.note });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s.startsWith("conflict:assigned:")) {
    return { ok: false, message: `They're booked on ${s.slice("conflict:assigned:".length)} over those days — reassign it on the Schedule first, or decline.` };
  }
  if (!s.startsWith("ok:")) return { ok: false, message: WORDING[s.replace("error:", "")] ?? s.replace("error:", "").replaceAll("_", " ") };
  revalidatePath("/pc/timesheets");
  revalidatePath("/pc/schedule");
  revalidatePath("/crm/today");
  const service = createServiceClient();
  if (service) after(() => notifyLeaveDecided(service, parsed.data.id));
  return { ok: true, message: parsed.data.approve ? "Approved — it's on the board as time off, and they've been told." : "Declined — they see why on their calendar." };
}

/** S7b: approve every standard (auto) day that is waiting and has a rate. One click for a normal week. */
export async function approveStandardDaysAction(): Promise<PcResult & { approved?: number; left?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("timesheet_entries").select("id").eq("status", "submitted").eq("source", "auto").order("work_date", { ascending: true }).limit(500);
  if (error) return { ok: false, message: error.message };
  let approved = 0; let left = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    const { data: r, error: aErr } = await supabase.rpc("timesheet_approve", { p_entry_id: row.id });
    if (!aErr && String(r ?? "").startsWith("ok:")) approved += 1; else left += 1;
  }
  revalidatePath("/pc/timesheets");
  return { ok: true, approved, left, message: `${approved} standard day${approved === 1 ? "" : "s"} approved${left ? ` — ${left} left (no cost rate covers them)` : ""}.` };
}

/** S7b: the standard day (start, finish, break) — what the autofill logs. */
export async function saveStandardDayAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({
    dayStart: z.string().regex(/^\d{2}:\d{2}$/),
    dayFinish: z.string().regex(/^\d{2}:\d{2}$/),
    breakMinutes: z.number().int().min(0).max(240),
  }).refine((v) => v.dayFinish > v.dayStart, { message: "finish after start" }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Start, finish (after the start) and a break of 0–240 minutes." };
  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert({ key: "timesheets", value: parsed.data }, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/pc/timesheets");
  return { ok: true, message: "Standard day saved — it applies from the next evening's fill." };
}

/** S7b: fill the standard days for a given date now (the sweep does this every evening). */
export async function autofillNowAction(raw: unknown): Promise<PcResult> {
  const parsed = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick a day." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timesheet_autofill", { p_day: parsed.data.day });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s === "error:day_not_over") return { ok: false, message: "That day hasn't finished yet — the fill runs after the standard finish time." };
  if (!s.startsWith("ok:")) return { ok: false, message: s.replace("error:", "").replaceAll("_", " ") };
  const m = /^ok:(\d+)(?::manual:(\d+))?/.exec(s);
  revalidatePath("/pc/timesheets");
  return { ok: true, message: `${m?.[1] ?? 0} standard day${m?.[1] === "1" ? "" : "s"} filled${m?.[2] ? ` — ${m[2]} painter${m[2] === "1" ? "" : "s"} on two jobs need a manual day` : ""}.` };
}
