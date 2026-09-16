/**
 * "Is this message still needed?" — asked the moment a pending or held
 * message is about to go (Session 1 rule 5: reminders stop themselves).
 *
 * One checker per automation key; anything without one is still needed.
 * Sessions 3–7 add theirs here: an invoice reminder checks the balance, a
 * sign-off reminder checks for a signature, an offer reminder checks the
 * offer is still open. Each returns a plain-English reason when it says no —
 * that reason lands on the skipped row for the office to read.
 *
 * SERVER ONLY (service client). A checker that throws is treated as "still
 * needed": a lookup hiccup must never lose a message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HoldRow } from "./dispatch";

export type NeedVerdict = { ok: true } | { ok: false; reason: string };
type Checker = (db: SupabaseClient, hold: HoldRow) => Promise<NeedVerdict>;

const CHECKERS: Record<string, Checker> = {
  // A booking confirmation held overnight is pointless if the job was un-booked or moved.
  appointment_confirmation: async (db, hold) => {
    if (!hold.work_order_id) return { ok: true };
    const { data } = await db.from("work_orders").select("start_date, contractor_id").eq("id", hold.work_order_id).maybeSingle();
    const w = data as { start_date: string | null; contractor_id: string | null } | null;
    if (!w?.start_date || !w.contractor_id) return { ok: false, reason: "The job is no longer booked in." };
    return { ok: true };
  },
  // The wizard resume link is moot once they finished.
  wizard_abandoned: async (db, hold) => {
    if (!hold.estimate_id) return { ok: true };
    const { data } = await db.from("estimates").select("status").eq("id", hold.estimate_id).maybeSingle();
    const s = (data as { status?: string } | null)?.status;
    if (s && s !== "draft" && s !== "wizard") return { ok: false, reason: "They finished their estimate in the meantime." };
    return { ok: true };
  },
};

export async function stillNeeded(db: SupabaseClient, hold: HoldRow): Promise<NeedVerdict> {
  const check = CHECKERS[hold.automation_key];
  if (!check) return { ok: true };
  try {
    return await check(db, hold);
  } catch {
    return { ok: true };
  }
}

/** For later sessions: register a checker from the module that owns the automation. */
export function registerStillNeeded(key: string, check: Checker): void {
  CHECKERS[key] = check;
}
