"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSignedReportEmail } from "@/lib/workorder/signEmail";
import { headers } from "next/headers";

/** The customer's walkthrough: approve or flag each area, then sign. */

export type AreaResult = { ok: true; state: "approved" | "flagged" } | { ok: false; message: string };
export type SignResult = { ok: true } | { ok: false; message: string; outstanding?: string[] };

const token = z.string().min(24).max(200);

export async function walkthroughAreaAction(raw: unknown): Promise<AreaResult> {
  const parsed = z.object({
    token, area: z.string().min(1).max(120), approve: z.boolean(), note: z.string().max(1000).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Something went wrong with that link." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_walkthrough_area", {
    p_token: parsed.data.token, p_area: parsed.data.area,
    p_approve: parsed.data.approve, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: "We couldn't record that just now — please try again." };

  const s = String(data ?? "");
  if (s === "ok:approved" || s === "ok:flagged") {
    revalidatePath(`/s/${parsed.data.token}`);
    return { ok: true, state: s === "ok:approved" ? "approved" : "flagged" };
  }
  if (s === "error:already_signed") return { ok: false, message: "This job has already been signed off." };
  return { ok: false, message: "We couldn't record that just now — please try again." };
}

export async function signAction(raw: unknown): Promise<SignResult> {
  const parsed = z.object({ token, name: z.string().trim().min(2).max(120) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please type your full name to sign." };

  const supabase = await createClient();

  // Resolve the CUSTOMER token BEFORE signing: wo_sign clears a Mode A session
  // token on success, so an after-the-fact lookup would find nothing and the
  // on-device path — the one ⚑10 exists for — would never email.
  const service = createServiceClient();
  const { data: pre } = service
    ? await service.from("wo_signoff").select("customer_token").or(
        `customer_token.eq.${parsed.data.token},walkthrough_session_token.eq.${parsed.data.token}`,
      ).maybeSingle()
    : { data: null };

  const { data, error } = await supabase.rpc("wo_sign", {
    p_token: parsed.data.token, p_name: parsed.data.name, p_kind: "remote", p_device: "web",
  });
  if (error) return { ok: false, message: "We couldn't record your sign-off — please try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath(`/s/${parsed.data.token}`);
    // ⚑10: the signed report goes to the customer at once. wo_sign derives the
    // kind server-side, so this token may have been a Mode A session — the
    // email always addresses the CUSTOMER token, which the service lookup
    // resolves from the same sign-off row. Best-effort by construction.
    if (service && pre?.customer_token) {
      const origin = (await headers()).get("origin")
        ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://paint-group-platform.vercel.app";
      await sendSignedReportEmail(service, pre.customer_token, origin);
    }
    return { ok: true };
  }
  if (s.startsWith("error:areas_outstanding:")) {
    const outstanding = s.slice("error:areas_outstanding:".length).split(",").filter(Boolean);
    return {
      ok: false,
      outstanding,
      message: `Please have a look at ${outstanding.join(", ")} before signing.`,
    };
  }
  if (s === "error:no_name") return { ok: false, message: "Please type your full name to sign." };
  return { ok: false, message: "We couldn't record your sign-off — please try again." };
}

export async function requestExtensionAction(raw: unknown): Promise<{ ok: boolean; message?: string }> {
  const parsed = z.object({ token, until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick a date and we'll hold it for you." };

  const supabase = await createClient();
  const { data } = await supabase.rpc("wo_request_extension", {
    p_token: parsed.data.token, p_until: parsed.data.until,
  });
  return String(data ?? "").startsWith("ok:")
    ? { ok: true }
    : { ok: false, message: "We couldn't record that — please give us a call." };
}
