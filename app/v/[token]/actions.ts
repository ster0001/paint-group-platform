"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The customer's answer to a priced variation. Token-only, exactly like the
 * quote: no id in the URL, and the RPC is the only thing that can move it.
 */
export type RespondResult = { ok: true; state: "approved" | "declined" } | { ok: false; message: string };

const input = z.object({
  token: z.string().min(24).max(200),
  approve: z.boolean(),
  note: z.string().max(1000).default(""),
});

export async function respondToVariationAction(raw: unknown): Promise<RespondResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Something went wrong with that link." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_customer_respond_variation", {
    p_token: parsed.data.token,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: "We couldn't record that just now — please try again." };

  const s = String(data ?? "");
  if (s === "ok:approved") { revalidatePath(`/v/${parsed.data.token}`); return { ok: true, state: "approved" }; }
  if (s === "ok:declined") { revalidatePath(`/v/${parsed.data.token}`); return { ok: true, state: "declined" }; }
  if (s.startsWith("error:already_")) {
    return { ok: false, message: "You've already answered this one — thanks, nothing more to do." };
  }
  return { ok: false, message: "We couldn't record that just now — please try again." };
}
