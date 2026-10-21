"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { movementsSettingsFrom, type MovementsSettings } from "@/lib/movements/types";

type Result = { ok: true } | { ok: false; message: string };

const clock = z.string().regex(/^\d{2}:\d{2}$/, "HH:MM");
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour like #0E8C9C");

const input = z.object({
  warehouse: z.object({
    label: z.string().max(60), address: z.string().max(200), suburb: z.string().max(80), postcode: z.string().regex(/^(\d{4})?$/, "four digits"),
    lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(),
  }),
  nearKm: z.number().min(1).max(50),
  planningHorizonDays: z.number().int().min(1).max(60),
  deliveryConfirmBy: clock,
  boardPeople: z.array(z.object({ id: z.string().uuid(), slots: z.enum(["half", "hour"]), colour: colour.optional(), checks: z.boolean().optional() })).max(30),
  showHowItWorks: z.boolean(),
  recordHireCosts: z.boolean(),
  defaultHalfTime: z.object({ AM: clock, PM: clock }),
});

/**
 * Settings → Movements (brief §3.1 settings row, Session 6): the warehouse, the Nearby
 * radius, the planning horizon, the delivery confirm time, who gets a staff lane (and
 * whether in hours), the hire-cost switch and the strip. One row, `settings.movements`,
 * read by every Movements screen and the SQL helpers (movements_settings()). Staff only
 * (settings_staff_all).
 */
export async function saveMovementsSettingsAction(raw: unknown): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Check the values." };
  const ids = new Set<string>();
  for (const b of p.data.boardPeople) { if (ids.has(b.id)) return { ok: false, message: "A person is on the board twice." }; ids.add(b.id); }
  const value: MovementsSettings = movementsSettingsFrom(p.data);
  const { error } = await supabase.from("settings").upsert({ key: "movements", value }, { onConflict: "key" });
  if (error) return { ok: false, message: "Couldn't save — please try again." };
  revalidatePath("/settings");
  revalidatePath("/pc/movements");
  return { ok: true };
}
