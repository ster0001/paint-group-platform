"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { bookVisit, moveVisit, setVisitStatus, type BookResult } from "@/lib/visits/book";

export type VisitActionResult = { ok: true; message: string; visitId?: string } | { ok: false; message: string };

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });

const after = (r: BookResult, okMessage: string): VisitActionResult => {
  revalidatePath("/crm/diary");
  revalidatePath("/crm/today");
  return r.ok ? { ok: true, message: okMessage, visitId: r.visitId } : { ok: false, message: r.message };
};

export async function bookVisitAction(input: {
  accountId?: string | null; propertyId?: string | null; estimateId?: string | null;
  staffId: string | null; startsAt: string; endsAt: string; kind?: string; note?: string | null; source?: "staff" | "phone";
}): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const parsed = z.object({
    accountId: uuid.nullable().optional(), propertyId: uuid.nullable().optional(), estimateId: uuid.nullable().optional(),
    staffId: uuid.nullable(), startsAt: iso, endsAt: iso,
    kind: z.enum(["quote", "remeasure", "colour_consult", "walkthrough"]).default("quote"),
    note: z.string().max(2000).nullable().optional(), source: z.enum(["staff", "phone"]).default("staff"),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pick an estimator, a date and a time." };
  const r = await bookVisit(supabase, parsed.data);
  if (r.ok && parsed.data.accountId) revalidatePath(`/crm/customers/${parsed.data.accountId}`);
  return after(r, "Booked. The customer gets the invite, and it's in the estimator's calendar.");
}

export async function visitOutcomeAction(visitId: string, status: "done" | "no_show" | "cancelled" | "rebook", note?: string): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  if (!uuid.safeParse(visitId).success) return { ok: false, message: "That isn't a visit." };
  const r = await setVisitStatus(supabase, visitId, status, note?.trim() || null);
  const { data: v } = await supabase.from("visits").select("account_id").eq("id", visitId).maybeSingle();
  if (v?.account_id) revalidatePath(`/crm/customers/${v.account_id}`);
  const said = { done: "Marked done — the record moves to “visit done”.", no_show: "No show recorded — it's on Today to rebook.",
    cancelled: "Cancelled. The calendar entry is pulled.", rebook: "Marked to rebook — it's on Today." }[status];
  return after(r, said);
}

export async function moveVisitAction(visitId: string, startsAt: string, endsAt: string, staffId: string | null): Promise<VisitActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const parsed = z.object({ visitId: uuid, startsAt: iso, endsAt: iso, staffId: uuid.nullable() }).safeParse({ visitId, startsAt, endsAt, staffId });
  if (!parsed.success) return { ok: false, message: "Pick a date and a time." };
  const r = await moveVisit(supabase, visitId, startsAt, endsAt, staffId);
  const { data: v } = await supabase.from("visits").select("account_id").eq("id", visitId).maybeSingle();
  if (v?.account_id) revalidatePath(`/crm/customers/${v.account_id}`);
  return after(r, "Moved. The customer gets the updated invite.");
}
