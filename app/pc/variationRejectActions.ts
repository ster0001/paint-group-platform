"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import { notifyVariationRejected } from "@/lib/contractor/notify";
import { reportError } from "@/lib/monitoring/report";

/**
 * The office rejects a painter's variation, with a reply (Tom, 8 Oct 2026).
 *
 * The RPC is the only thing that moves the row (staff-only, 'raised' only —
 * 20270240). The reply then goes to the painter by text + email and the answer
 * comes back in words: what was sent, or why nothing was — "has no mobile or
 * email on file" is the answer that matters.
 */
export type RejectResult = { ok: true; message: string; delivered: boolean } | { ok: false; message: string };

const input = z.object({
  variationId: z.string().uuid(),
  reply: z.string().trim().min(3, "Write a short reply for the painter.").max(1000),
});

export async function rejectVariationAction(raw: unknown): Promise<RejectResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Staff only." };

  const { data, error } = await supabase.rpc("wo_office_reject_variation", {
    p_variation_id: parsed.data.variationId,
    p_note: parsed.data.reply,
  });
  if (error) {
    if (isMissingRpc(error.message, "wo_office_reject_variation")) {
      return { ok: false, message: "Rejecting needs migration 20270240 — run it first." };
    }
    reportError(error, { where: "pc.rejectVariation", extra: { variationId: parsed.data.variationId } });
    return { ok: false, message: "Couldn't reject that just now — please try again." };
  }
  const s = String(data ?? "");
  if (s === "error:not_staff") return { ok: false, message: "Staff only." };
  if (s === "error:not_found") return { ok: false, message: "That variation no longer exists." };
  if (s === "error:note_required") return { ok: false, message: "Write a short reply for the painter." };
  if (s === "error:not_raised") return { ok: false, message: "This one has moved on — it is no longer waiting on the office." };
  if (s === "ok:already") return { ok: true, message: "Already rejected — nothing more was sent.", delivered: false };
  if (s !== "ok:declined") {
    reportError(new Error(`wo_office_reject_variation answered ${s}`), { where: "pc.rejectVariation" });
    return { ok: false, message: "Couldn't reject that just now — please try again." };
  }

  revalidatePath("/pc");
  revalidatePath("/pc/wo/[id]", "page");
  revalidatePath("/portal/jobs/[id]", "page");

  const service = createServiceClient();
  if (!service) return { ok: true, message: "Rejected — but messaging isn't configured on this server, so the painter wasn't told.", delivered: false };
  const r = await notifyVariationRejected(service, parsed.data.variationId, user.id);
  const who = r.painter && r.painter !== "there" ? r.painter : "the painter";
  if (r.outcome === "notified") {
    const how = r.channels.map((c) => (c === "sms" ? "texted" : c === "email" ? "emailed" : c)).join(" and ");
    return { ok: true, message: `Rejected — ${how} your reply to ${who}.`, delivered: true };
  }
  if (r.outcome === "skipped") return { ok: true, message: `Rejected — but your reply didn't reach ${who}. ${r.reason}`, delivered: false };
  return { ok: true, message: "Rejected.", delivered: false };
}
