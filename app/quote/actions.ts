"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { sendEstimateInput } from "@/lib/validation/estimate";
import { DEFAULT_MESSAGING, MESSAGING_KEY, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildEstimateEmailHtml, emailConfigured, sendEmail, sendSms, smsConfigured, type DeliveryResult } from "@/lib/messaging/send";
import { DEFAULT_COMPANY, type CompanyProfile, type Contact } from "./company";
import type { ActionResult } from "@/app/(app)/schedule/actions";

/** Per-channel outcome shown back in the send dialog. */
export type DeliveryOutcome = {
  email?: { status: DeliveryResult["status"]; message?: string };
  sms?: { status: DeliveryResult["status"]; message?: string };
};

export type SendResult = ActionResult & { delivery?: DeliveryOutcome };

/**
 * The customer link is derived HERE, never accepted from the client — a
 * tampered request can change the wording of the email but not where its
 * button points.
 */
async function baseUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Estimate lifecycle actions.
 *
 * Sending is a guarded transition, not a column write: the database refuses to
 * send an accepted quote, and refuses if the screen's idea of the current
 * status is out of date. Email/SMS delivery happens AFTER the transition
 * succeeds and is best-effort — a delivery failure never rolls back the send,
 * it's reported back to the screen and logged on the activity feed instead.
 */
export async function sendEstimateAction(raw: unknown): Promise<SendResult> {
  const parsed = sendEstimateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, kind: "invalid", message: parsed.error.issues[0]?.message ?? "That input isn't valid." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, kind: "error", message: "You don't have permission to do that." };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return { ok: false, kind: "error", message: "You don't have permission to do that." };

  const v = parsed.data;
  const { data, error } = await supabase.rpc("send_estimate", {
    p_estimate_id: v.estimateId,
    p_expected_status: v.expectedStatus,
    p_valid_until: v.validUntil ?? null,
  });
  if (error) return { ok: false, kind: "error", message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    const delivery = await deliver(supabase, v);
    revalidatePath("/estimates");
    return { ok: true, state: s.slice(3), delivery };
  }
  if (s.startsWith("conflict:")) {
    const actual = s.slice(9);
    return {
      ok: false,
      kind: "conflict",
      actualState: actual,
      message: actual === "accepted"
        ? "This quote has been accepted and is locked — it can't be re-sent."
        : "This estimate has changed since the page loaded — refresh.",
    };
  }
  const reason = s.replace("error:", "");
  const wording: Record<string, string> = {
    not_staff: "You don't have permission to do that.",
    not_saved: "Save the estimate before sending it.",
    nothing_to_send: "There's nothing published yet — save first.",
    not_found: "That estimate no longer exists.",
  };
  return { ok: false, kind: "error", message: wording[reason] ?? `Couldn't send that (${reason}).` };
}

type SendInput = ReturnType<typeof sendEstimateInput.parse>;

async function deliver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  v: SendInput,
): Promise<DeliveryOutcome | undefined> {
  if (!v.email && !v.sms) return undefined;

  // Everything that goes into the message body beyond the typed wording comes
  // from the database, not the request.
  const [{ data: est }, { data: settingsRows }] = await Promise.all([
    supabase.from("estimates").select("share_token, title, total_cents, builder_state").eq("id", v.estimateId).single(),
    supabase.from("settings").select("key, value").in("key", ["company_profile", MESSAGING_KEY]),
  ]);
  if (!est?.share_token) {
    const failed = { status: "error" as const, message: "Estimate link missing — save and try again." };
    return { ...(v.email ? { email: failed } : {}), ...(v.sms ? { sms: failed } : {}) };
  }

  const rows = (settingsRows as { key: string; value: unknown }[] | null) ?? [];
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((rows.find((r) => r.key === "company_profile")?.value as Partial<CompanyProfile>) ?? {}) };
  const messaging: MessagingSettings = { ...DEFAULT_MESSAGING, ...((rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings>) ?? {}) };

  const link = `${await baseUrl()}/e/${est.share_token}`;
  const contact = ((est.builder_state as { contact?: Contact } | null)?.contact ?? null);
  const totalLabel = est.total_cents
    ? `${(est.total_cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })} inc GST`
    : undefined;
  const vars = {
    first_name: contact?.first_name || "there",
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || contact?.company || "there",
    company_name: company.name,
    estimate_title: est.title ?? "",
    total: totalLabel ?? "",
    estimator_name: company.estimatorName,
    link,
  };

  const outcome: DeliveryOutcome = {};

  if (v.email) {
    let result: DeliveryResult;
    if (!emailConfigured()) {
      result = { status: "not_configured" };
    } else {
      result = await sendEmail({
        to: v.email.to,
        subject: v.email.subject,
        replyTo: company.email || undefined,
        html: buildEstimateEmailHtml({
          intro: v.email.message,
          link,
          companyName: company.name,
          logoUrl: company.logoUrl || undefined,
          estimatorName: company.estimatorName || undefined,
          estimatorTitle: company.estimatorTitle || undefined,
          estimatorPhone: company.estimatorPhone || undefined,
          companyPhone: company.phone || undefined,
          totalLabel,
        }),
      });
    }
    outcome.email = { status: result.status, ...("message" in result ? { message: result.message } : {}) };
    await logDelivery(supabase, v.estimateId, "email", v.email.to, result);
  }

  if (v.sms) {
    let result: DeliveryResult;
    const to = normalisePhoneAU(v.sms.to);
    if (!smsConfigured()) {
      result = { status: "not_configured" };
    } else if (!to) {
      result = { status: "error", message: "That mobile number doesn't look like an Australian number." };
    } else {
      result = await sendSms({ to, body: renderTemplate(messaging.smsTemplate, vars) });
    }
    outcome.sms = { status: result.status, ...("message" in result ? { message: result.message } : {}) };
    await logDelivery(supabase, v.estimateId, "sms", v.sms.to, result);
  }

  return outcome;
}

async function logDelivery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  channel: "email" | "sms",
  to: string,
  result: DeliveryResult,
) {
  if (result.status === "not_configured") return; // nothing happened — nothing to log
  await supabase.from("estimate_events").insert({
    estimate_id: estimateId,
    type: result.status === "sent" ? `${channel}_sent` : `${channel}_failed`,
    payload: { to, ...(result.status === "error" ? { error: result.message } : {}) },
  });
}
