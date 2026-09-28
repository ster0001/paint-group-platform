"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSignedReportEmail } from "@/lib/workorder/signEmail";
import { trustedOrigin } from "@/lib/security/trustedOrigin";

/** The customer's walkthrough: approve or flag each area, then sign. */

export type AreaResult = { ok: true; state: "approved" | "flagged" } | { ok: false; message: string };
export type SignResult =
  /** onDevice: signed through a Mode A session token — that token is dead now,
   *  so the painter's (or staff's) device must go back to the job, not reload. */
  | { ok: true; onDevice: boolean }
  | { ok: false; message: string; outstanding?: string[] };

/** Sign-off tokens are hex (Postgres gen_random_uuid pairs) or base64url —
 *  never anything else. The charset matters, not just the length: the token
 *  is interpolated into a PostgREST `or=` filter below, whose grammar is
 *  comma/bracket-delimited, so a `,` or `)` in it would rewrite the filter
 *  (18 Sep security audit). Same guard as app/a/[token]/page.tsx. */
const token = z.string().regex(/^[A-Za-z0-9_-]{24,200}$/);

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
  // Tom, 28 Sep: a DRAWN signature, the same pad the estimate is signed on.
  // The signer's name is the job's own (the accepted estimate) — nothing typed.
  const parsed = z.object({
    token,
    signature: z.string().startsWith("data:image/png;base64,").min(100).max(400_000),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please sign in the box to sign off." };

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

  const { data, error } = await supabase.rpc("wo_sign_drawn", {
    p_token: parsed.data.token, p_signature: parsed.data.signature, p_device: "web",
  });
  if (error) {
    if (/wo_sign_drawn/.test(error.message)) return { ok: false, message: "Signing isn't switched on yet — please give us a call and we'll sort it." };
    return { ok: false, message: "We couldn't record your sign-off — please try again." };
  }

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    // Mode A: wo_sign has just NULLED this session token. Revalidating its path
    // re-renders the page against a token that no longer resolves — notFound,
    // i.e. the 404 the painter saw after signing (Tom, 23 Aug). The customer's
    // own link is the one that re-renders into the signed report.
    // NOTE: ANY revalidatePath inside a server action re-renders the CURRENT
    // route, whatever path it names — so on-device we revalidate nothing at
    // all. The job pages are dynamic; they read the closed stage on arrival.
    const onDevice = Boolean(pre && pre.customer_token !== parsed.data.token);
    if (!onDevice) revalidatePath(`/s/${parsed.data.token}`);
    // ⚑10: the signed report goes to the customer at once. wo_sign derives the
    // kind server-side, so this token may have been a Mode A session — the
    // email always addresses the CUSTOMER token, which the service lookup
    // resolves from the same sign-off row. Best-effort by construction.
    if (service && pre?.customer_token) {
      await sendSignedReportEmail(service, pre.customer_token, await trustedOrigin());
    }
    return { ok: true, onDevice };
  }
  if (s.startsWith("error:areas_outstanding:")) {
    const outstanding = s.slice("error:areas_outstanding:".length).split(",").filter(Boolean);
    return {
      ok: false,
      outstanding,
      message: `Please have a look at ${outstanding.join(", ")} before signing.`,
    };
  }
  if (s === "error:signature_required" || s === "error:no_name") return { ok: false, message: "Please sign in the box to sign off." };
  if (s === "error:signature_too_big") return { ok: false, message: "That signature is a little too detailed — clear it and sign again." };
  // The final walkthrough is still booked ahead (Mode B): they are meant to
  // walk it with the painter first. Say so, rather than a blank error.
  if (s === "error:walkthrough_first") {
    return { ok: false, message: "Your final walkthrough with the painter is still booked — sign-off happens there. If you can't make it, give us a call and we'll open this link for you." };
  }
  if (s === "error:not_found") return { ok: false, message: "This link has expired — please use the link in your email, or give us a call." };
  if (s === "ok:already") return { ok: true, onDevice: false };
  // The job is not at walkthrough — something is still with the painter
  // (17 Sep: a signature must never half-land on a job that cannot close).
  if (s.startsWith("error:not_at_walkthrough:")) {
    return { ok: false, message: "Your painter still has something to put right on this job — sign-off opens again once it's done." };
  }
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
