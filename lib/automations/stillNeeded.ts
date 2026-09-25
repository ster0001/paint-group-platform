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

// ---- Session 3: money and sign-off --------------------------------------------
async function invoiceOwing(db: SupabaseClient, invoiceId: string): Promise<NeedVerdict> {
  const { data } = await db.from("invoices").select("status, total_inc_cents, chase_hold_reason").eq("id", invoiceId).maybeSingle();
  const inv = data as { status: string; total_inc_cents: number; chase_hold_reason: string | null } | null;
  if (!inv || !["issued", "sent", "viewed", "partially_paid"].includes(inv.status)) return { ok: false, reason: "The invoice is no longer open." };
  if (inv.chase_hold_reason) return { ok: false, reason: `Reminders paused: ${inv.chase_hold_reason}` };
  const { data: pays } = await db.from("payments").select("amount_cents").eq("invoice_id", invoiceId).eq("status", "succeeded");
  const paid = ((pays ?? []) as { amount_cents: number }[]).reduce((n, p) => n + p.amount_cents, 0);
  return paid >= inv.total_inc_cents ? { ok: false, reason: "Paid." } : { ok: true };
}
CHECKERS.invoice_reminder = (db, hold) => (hold.invoice_id ? invoiceOwing(db, hold.invoice_id) : Promise.resolve({ ok: true }));
CHECKERS.deposit_reminder = CHECKERS.invoice_reminder;
CHECKERS.signoff_reminder = async (db, hold) => {
  if (!hold.work_order_id) return { ok: true };
  const { data } = await db.from("wo_signoff").select("signed_at").eq("work_order_id", hold.work_order_id).maybeSingle();
  return (data as { signed_at: string | null } | null)?.signed_at ? { ok: false, reason: "Signed off." } : { ok: true };
};
// Tom, 25 Sep: an "update your work order" text held for approval is moot once the job has moved on.
CHECKERS.contractor_job_update_reminder = async (db, hold) => {
  if (!hold.work_order_id) return { ok: true };
  const { data, error } = await db.from("work_orders").select("stage").eq("id", hold.work_order_id).maybeSingle();
  if (error) throw error;   // a checker that throws is "still needed" — a hiccup never loses a message
  const s = (data as { stage?: string } | null)?.stage;
  return s && ["pre_start", "in_progress", "completion_prep"].includes(s) ? { ok: true } : { ok: false, reason: `The job is at ${s ?? "gone"}.` };
};
CHECKERS.contractor_invoice_prompt = async (db, hold) => {
  if (!hold.work_order_id) return { ok: true };
  const { data } = await db.from("contractor_invoices").select("status").eq("work_order_id", hold.work_order_id).eq("auto_draft_source", "signoff").limit(1).maybeSingle();
  const s = (data as { status?: string } | null)?.status;
  return !s || s === "draft" ? { ok: true } : { ok: false, reason: `Invoice ${s}.` };
};

// ---- Session 4: painters --------------------------------------------------------
// A held offer reminder is pointless once the offer was answered, withdrawn or
// lapsed. The live offer for the job must still be 'offered' and unexpired.
CHECKERS.contractor_offer_reminder = async (db, hold) => {
  if (!hold.work_order_id) return { ok: true };
  const { data, error } = await db.from("booking_offers").select("state, expires_at")
    .eq("work_order_id", hold.work_order_id).in("state", ["offered", "proposed"]).limit(1).maybeSingle();
  if (error) throw error;
  const o = data as { state: string; expires_at: string } | null;
  if (!o || o.state !== "offered") return { ok: false, reason: "The offer has been answered." };
  if (new Date(o.expires_at).getTime() <= Date.now()) return { ok: false, reason: "The offer has expired." };
  return { ok: true };
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
