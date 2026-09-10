"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { staffOfferResponded } from "@/lib/staff/notify";

/**
 * Tom, 10 Sep: "job approved / job declined — tell the staff." The painter's
 * answer to an offer is a browser → Postgres RPC (respond_to_offer) with no
 * server seam, the /e-page acceptance pattern — so the two callers ping this
 * after the RPC says accepted / proposed / declined. The offer row itself is
 * the truth (state + contractor), the caller is only allowed to ping about
 * their own offer, and the alert is once-only per offer, so a re-ping is a
 * no-op. Best-effort: never awaited for anything that matters.
 */
export async function notifyOfferRespondedAction(raw: unknown): Promise<void> {
  const parsed = z.object({ offerId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const svc = createServiceClient();
  if (!svc) return;
  const { data } = await svc
    .from("booking_offers").select("id, state, contractors(profile_id)")
    .eq("id", parsed.data.offerId).maybeSingle();
  const o = data as { id: string; state: string; contractors: { profile_id: string | null } | null } | null;
  if (!o || o.contractors?.profile_id !== user.id) return;
  if (!["accepted", "proposed", "declined"].includes(o.state)) return;
  await staffOfferResponded(svc, o.id);
}
