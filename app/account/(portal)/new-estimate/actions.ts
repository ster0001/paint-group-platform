"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { wizardStateShapeSchema } from "@/lib/wizard/state";
import { flagsWithSpec, flagsWithoutSpec, specFromState, specsFromFlags, MAX_SPECS } from "@/lib/wizard/saved-specs";

/**
 * Saving a spec (estimator journey v2 §7, phase 8).
 *
 * A spec is named from a job the member has already done — which is the only
 * honest way to make one. Nobody sits down to invent "end-of-lease repaint" in
 * the abstract; they do the job, notice they will do it forty more times, and
 * name it. So there is no spec BUILDER, just a name on a job they already
 * chose the answers for.
 *
 * The answers are taken from the estimate's stored wizard state SERVER-SIDE,
 * so the client never posts the spec's contents — the same boundary the whole
 * wizard keeps. A member may only name their own account's job.
 */

const saveInput = z.object({
  estimateId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  colourPolicy: z.string().trim().max(200).default(""),
});

export type SaveSpecResult = { ok: true } | { ok: false; message: string };

export async function saveSpecFromEstimate(raw: unknown): Promise<SaveSpecResult> {
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Give the spec a name." };

  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, message: "Sign in again to save this." };
  const trade = ctx.accounts.find((a) => a.account_type === "trade");
  if (!trade) return { ok: false, message: "Saved specs are a trade-account feature." };

  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "That isn't available just now — try again shortly." };

  // The job must belong to one of the caller's OWN accounts. Reading it with
  // the service client is what makes the ownership check load-bearing rather
  // than decorative, so it is done explicitly and by id.
  const owned = new Set(ctx.accounts.map((a) => a.id));
  const { data: est } = await svc
    .from("estimates")
    .select("account_id, wizard_state:builder_state->wizard->state")
    .eq("id", parsed.data.estimateId)
    .maybeSingle();
  if (!est?.account_id || !owned.has(est.account_id as string)) {
    return { ok: false, message: "We couldn't find that job on your account." };
  }

  // The SHAPE schema: a stored state is a seed here, not something being
  // submitted, and the full schema's cross-field rules would refuse states a
  // spec can perfectly well be made from.
  const state = wizardStateShapeSchema.safeParse(est.wizard_state);
  if (!state.success) {
    return { ok: false, message: "That job was built before we could save specs from it." };
  }

  const { data: acct } = await svc.from("accounts").select("flags").eq("id", trade.id).maybeSingle();
  const existing = specsFromFlags((acct as { flags?: unknown } | null)?.flags);
  if (existing.length >= MAX_SPECS) {
    return { ok: false, message: `You can keep ${MAX_SPECS} specs — remove one first.` };
  }

  const spec = specFromState(state.data, parsed.data.name, { colourPolicy: parsed.data.colourPolicy });
  const { error } = await svc
    .from("accounts")
    .update({ flags: flagsWithSpec((acct as { flags?: unknown } | null)?.flags, spec) })
    .eq("id", trade.id);
  if (error) return { ok: false, message: "That didn't save — try again in a moment." };

  revalidatePath("/account/new-estimate");
  return { ok: true };
}

export async function removeSpec(id: string): Promise<SaveSpecResult> {
  if (typeof id !== "string" || id.length === 0 || id.length > 40) {
    return { ok: false, message: "We couldn't find that spec." };
  }
  const ctx = await getPortalContext();
  const trade = ctx?.accounts.find((a) => a.account_type === "trade");
  if (!trade) return { ok: false, message: "Sign in again to change this." };
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "That isn't available just now — try again shortly." };

  const { data: acct } = await svc.from("accounts").select("flags").eq("id", trade.id).maybeSingle();
  const { error } = await svc
    .from("accounts")
    .update({ flags: flagsWithoutSpec((acct as { flags?: unknown } | null)?.flags, id) })
    .eq("id", trade.id);
  if (error) return { ok: false, message: "That didn't save — try again in a moment." };

  revalidatePath("/account/new-estimate");
  return { ok: true };
}
