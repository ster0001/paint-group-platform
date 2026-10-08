"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/supabase/guards";
import { answerWithTime, markAnswered } from "@/lib/visits/requests";

/** Staff answer a request (addendum A §4.4): offer a time, or mark it answered another way. */
type Result = { ok: true; visitId?: string } | { ok: false; message: string };

async function gate() {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  const svc = createServiceClient();
  return user && svc ? { user, svc } : null;
}

export async function offerTimeAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ requestId: z.string().uuid(), estimatorId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick a time." };
  const g = await gate();
  if (!g) return { ok: false, message: "Staff only." };
  const r = await answerWithTime(g.svc, { ...parsed.data, staffId: g.user.id });
  if (!r.ok) return r;
  revalidatePath(`/crm/visit-requests/${parsed.data.requestId}`);
  revalidatePath("/crm/today");
  revalidatePath("/crm/diary");
  return { ok: true, visitId: r.visitId };
}

export async function markAnsweredAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ requestId: z.string().uuid(), answer: z.string().trim().max(600) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const g = await gate();
  if (!g) return { ok: false, message: "Staff only." };
  const r = await markAnswered(g.svc, { ...parsed.data, staffId: g.user.id });
  if (!r.ok) return r;
  revalidatePath(`/crm/visit-requests/${parsed.data.requestId}`);
  revalidatePath("/crm/today");
  return { ok: true };
}
