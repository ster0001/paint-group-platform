/**
 * The one door for the customer-facing visit routes (S3): who is asking, and
 * is this their estimate. An anonymous visitor may only act on the draft their
 * own session created (`customerOwnsDraft`); staff may act on any. The
 * service client does the reads — a customer has no table access — exactly as
 * /api/wizard/keep does.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor, type WizardActor } from "@/lib/supabase/guards";
import { ESTIMATE_CORE_SELECT, type EstimateCore } from "./holds";

export type Owned = { svc: SupabaseClient; actor: Exclude<WizardActor, { kind: "none" }>; est: EstimateCore };

export async function loadOwnedEstimate(estimateId: string): Promise<Owned | NextResponse> {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Open your estimate from the link we sent you.", code: "signed_out" }, { status: 403 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "Booking isn't available just now.", code: "unavailable" }, { status: 503 });
  const { data, error } = await svc.from("estimates").select(ESTIMATE_CORE_SELECT).eq("id", estimateId).maybeSingle();
  if (error) return NextResponse.json({ error: "We couldn't read that estimate.", code: "failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "We couldn't find that estimate.", code: "not_found" }, { status: 404 });
  const est = data as EstimateCore;
  if (actor.kind === "customer" && !(await customerOwnsDraft(svc, actor, est))) {
    return NextResponse.json({ error: "That isn't your estimate.", code: "forbidden" }, { status: 403 });
  }
  return { svc, actor, est };
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
