"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { mergeVisitsSettings } from "@/lib/visits/types";
import { VISITS_SETTINGS_KEY } from "@/lib/visits/book";

type Result = { ok: true } | { ok: false; message: string };

export async function saveVisitsSettingsAction(raw: unknown): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const merged = mergeVisitsSettings(raw);
  for (const part of ["am", "pm"] as const) {
    if (merged.windows[part][0] >= merged.windows[part][1]) return { ok: false, message: `The ${part === "am" ? "morning" : "afternoon"} window has to end after it starts.` };
  }
  const { error } = await supabase.from("settings").upsert({ key: VISITS_SETTINGS_KEY, value: merged }, { onConflict: "key" });
  if (error) return { ok: false, message: "Couldn't save — please try again." };
  revalidatePath("/settings");
  revalidatePath("/crm/diary");
  return { ok: true };
}

const rowSchema = z.object({
  staffId: z.string().uuid(),
  takesVisits: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  dayStart: z.string().regex(/^\d{2}:\d{2}$/),
  dayEnd: z.string().regex(/^\d{2}:\d{2}$/),
  visitMinutes: z.number().int().min(15).max(240),
  zone: z.string().max(40).default("melbourne-metro"),
});

export async function saveStaffAvailabilityAction(raw: unknown): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the days, hours and visit length." };
  const r = parsed.data;
  if (r.dayStart >= r.dayEnd) return { ok: false, message: "The day has to end after it starts." };
  const { error } = await supabase.from("staff_availability").upsert({
    staff_id: r.staffId, takes_visits: r.takesVisits, days: r.days, day_start: r.dayStart, day_end: r.dayEnd, visit_minutes: r.visitMinutes, zone: r.zone,
  }, { onConflict: "staff_id" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  revalidatePath("/crm/diary");
  return { ok: true };
}
