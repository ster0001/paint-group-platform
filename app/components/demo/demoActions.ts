"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { createServiceClient } from "@/lib/supabase/service";
import { sendDemoPrompt } from "@/lib/demo/prompt";

/**
 * 12 Demo Street (induction brief §4, Step 1). Two entry points, both the
 * migration-20270262 RPCs: seed (idempotent) and reset (delete + re-seed in
 * one transaction). A contractor acts on their own demo; staff name the
 * contractor. The RPC decides who may — these only carry the answer back in
 * the painter's words.
 */
const Input = z.object({ contractorId: z.string().uuid().nullable().optional() });

type Result = { ok: true; workOrderId: string; existed: boolean } | { ok: false; message: string };

function plain(r: string): string {
  if (r === "error:not_allowed") return "You can only set up your own practice job.";
  if (r === "error:employee") return "The practice job is for contractors — your induction demo arrives with the worker induction.";
  return `Couldn't do that (${r.replace("error:", "")}).`;
}

function refresh(contractorId: string | null | undefined) {
  revalidatePath("/portal"); revalidatePath("/portal/jobs"); revalidatePath("/portal/requests");
  revalidatePath("/pc"); revalidatePath("/pc/wo/[id]", "page");
  if (contractorId) revalidatePath(`/contractors/${contractorId}`);
}

export async function seedDemoAction(raw: unknown): Promise<Result> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("demo_property_seed", { p_contractor_id: parsed.data.contractorId ?? null });
  if (error) { reportError(error, { where: "demo.seed" }); return { ok: false, message: "Couldn't set up the practice job — it has been reported." }; }
  const r = String(data ?? "");
  if (r.startsWith("ok:") || r.startsWith("exists:")) {
    refresh(parsed.data.contractorId);
    return { ok: true, workOrderId: r.slice(r.indexOf(":") + 1), existed: r.startsWith("exists:") };
  }
  return { ok: false, message: plain(r) };
}

/**
 * The facilitator's "Send demo prompt" (Module 6): staff only — the ONE real
 * text of the induction, through the messaging adapter (lib/demo/prompt.ts).
 */
export async function sendDemoPromptAction(raw: unknown): Promise<{ ok: true; outcome: string } | { ok: false; message: string }> {
  const parsed = z.object({ workOrderId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  const { data: me, error: meErr } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr) { reportError(meErr, { where: "demo.prompt.role" }); return { ok: false, message: "Couldn't check your login — it has been reported." }; }
  if ((me as { role?: string } | null)?.role !== "staff") return { ok: false, message: "Only the office can send the demo text." };
  const service = createServiceClient();
  if (!service) return { ok: false, message: "Messaging isn't set up on this server." };
  const r = await sendDemoPrompt(service, parsed.data.workOrderId);
  if (r.ok) revalidatePath("/pc/wo/[id]", "page");
  return r;
}

export async function resetDemoAction(raw: unknown): Promise<Result> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("demo_property_reset", { p_contractor_id: parsed.data.contractorId ?? null });
  if (error) { reportError(error, { where: "demo.reset" }); return { ok: false, message: "Couldn't reset the practice job — it has been reported." }; }
  const r = String(data ?? "");
  if (r.startsWith("ok:")) { refresh(parsed.data.contractorId); return { ok: true, workOrderId: r.slice(3), existed: false }; }
  return { ok: false, message: plain(r) };
}
