"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyVariationReleased } from "@/lib/contractor/notify";

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

const signInput = z.object({
  token: z.string().min(24).max(200),
  name: z.string().min(1).max(200),
  // The drawn signature — a PNG data URL from the shared SignaturePad. The RPC
  // re-validates shape and size; this is the polite first fence.
  signature: z.string().startsWith("data:image/png;base64,").min(100).max(400000),
});

export async function signVariationAction(raw: unknown): Promise<RespondResult> {
  const parsed = signInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please add your name and sign in the box." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_customer_sign_variation", {
    p_token: parsed.data.token,
    p_name: parsed.data.name,
    p_signature: parsed.data.signature,
  });
  if (error) return { ok: false, message: "We couldn't record that just now — please try again." };

  const s = String(data ?? "");
  if (s === "ok:approved") {
    revalidatePath(`/v/${parsed.data.token}`);
    // The auto-release arm inside wo_customer_sign_variation may have put it
    // straight with the painter — text them (idempotent; a not-released or
    // zero-hours-auto-accepted variation is a no-op inside the notifier).
    const service = createServiceClient();
    if (service) {
      const token = parsed.data.token;
      after(async () => {
        const { data: v } = await service
          .from("wo_variations").select("id").eq("customer_token", token).maybeSingle();
        const id = (v as { id?: string } | null)?.id;
        if (id) await notifyVariationReleased(service, id);
      });
    }
    return { ok: true, state: "approved" };
  }
  if (s.startsWith("error:already_")) {
    return { ok: false, message: "You've already answered this one — thanks, nothing more to do." };
  }
  if (s === "error:name_required") return { ok: false, message: "Please enter your full name." };
  if (s === "error:signature_required") return { ok: false, message: "Please sign in the box to approve." };
  return { ok: false, message: "We couldn't record that just now — please try again." };
}

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
