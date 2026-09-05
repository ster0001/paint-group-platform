import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { bucketFor } from "@/lib/wizard/journey";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * Brief §3 — the two outcomes a customer can set from ANY page:
 *   help_requested   "I'm stuck, call me" in the wizard (net-new control)
 *   question_asked   "Talk to a person" in the assistant (the AI helper)
 * A call or visit request after the price goes through the estimate's own
 * wizard-edit route, which files the same columns. Either way the session's
 * bucket becomes Needs help and the account timeline gets an event, which
 * is what puts it on Today (lib/crm/work-queue.ts buildWizardItems).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  outcome: z.enum(["help_requested", "question_asked"]),
  phone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(600).optional(),
  page: z.number().int().min(1).max(12).optional(),
  pageLabel: z.string().trim().max(40).optional(),
});

export async function POST(req: Request) {
  const quietly = (why: string) => NextResponse.json({ ok: false, why });
  let raw: unknown;
  try { raw = await req.json(); } catch { return quietly("unreadable"); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return quietly("shape");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return quietly("no session");
  const db = createServiceClient();
  if (!db) return quietly("no service client");

  try {
    // The open draft, else the most recent finished one (a question can come
    // after the price, from the assistant).
    const { data: d } = await db.from("wizard_drafts")
      .select("id, account_id, estimate_id, phone, converted_at")
      .eq("user_id", user.id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    if (!d) return quietly("no draft");
    const now = new Date();
    const nowIso = now.toISOString();
    const { outcome, phone, note, page, pageLabel } = parsed.data;
    const noteText = [note, pageLabel ? `(${pageLabel})` : ""].filter(Boolean).join(" ").slice(0, 2000) || null;
    const { error } = await db.from("wizard_drafts").update({
      outcome, outcome_at: nowIso, outcome_note: noteText,
      last_seen_at: nowIso,
      ...(page ? { current_page: page } : {}),
      ...(phone && !d.phone ? { phone } : {}),
      bucket: bucketFor({ completed: d.converted_at != null, outcome, lastActiveAt: nowIso, now }),
    }).eq("id", d.id);
    if (error) { reportError(error, { where: "wizard.outcome", bestEffort: true }); return quietly("update"); }

    await logCrmEvent(db, {
      type: outcome === "help_requested" ? "wizard_help_requested" : "wizard_question_asked",
      source: "customer",
      accountId: (d.account_id as string | null) ?? null,
      estimateId: (d.estimate_id as string | null) ?? null,
      payload: { phone: phone || undefined, note: note || undefined, page: pageLabel || undefined },
      dedupeKey: `wizard-outcome:${d.id}:${outcome}:${nowIso.slice(0, 16)}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, { where: "wizard.outcome", bestEffort: true });
    return quietly("threw");
  }
}
