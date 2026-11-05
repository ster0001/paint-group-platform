/**
 * The gate's one-time code (Tom, 5 Nov 2026): a customer sees the price only
 * after proving the mobile they typed. SERVER ONLY beyond the pure helpers at
 * the top — the two routes under /api/wizard/otp and /api/wizard/submit are
 * the callers; the client talks to them through lib/wizard/otpClient.ts.
 *
 * The rules live in the database (migration 20270308, `wizard_otp_send` /
 * `wizard_otp_verify` / `wizard_otp_verified`): 6 digits, 10 minutes, 5 tries
 * per code, 3 sends per mobile per hour with 60 s between them, 30 per IP per
 * hour; a verified mobile stays verified for the draft for 24 hours. This file
 * normalises, hashes, texts and maps the outcomes — the same shape as the visit
 * booking's code (lib/visits/holds.ts), which it deliberately mirrors: the text
 * goes out through the one SMS sender (lib/messaging/send.ts) and is recorded
 * in `messages` whether or not Twilio is configured, which is how the e2e
 * suite reads the code back on a stack with no SMS.
 */
import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms } from "@/lib/messaging/send";
import { normalisePhoneAU } from "@/lib/messaging/config";
import { brandFor } from "@/lib/marketing/brand";
import { reportError } from "@/lib/monitoring/report";
import type { WizardBrand } from "./brand";

export { OTP_LENGTH, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_SENDS_PER_HOUR, OTP_RESEND_GAP_S, maskMobile, normaliseMobile, otpSmsBody } from "./otpFormat";
import { OTP_LENGTH, maskMobile, otpSmsBody } from "./otpFormat";

export const newOtpCode = (): string => String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const SALT = () => process.env.VISIT_CODE_SALT ?? process.env.WIZARD_IP_SALT ?? "";
/** Salted and bound to the user and the mobile, so a hash from one draft says nothing about another. */
export const hashOtp = (userId: string, mobile: string, code: string, salt = SALT()) =>
  createHash("sha256").update(`otp:${userId}:${mobile}:${code}:${salt}`).digest("hex");

/** The same recipe as /api/wizard/submit's ipHash; null when the address is unknown (a loopback run has no proxy header). */
export function otpIpHash(get: (name: string) => string | null): string | null {
  const ip = get("x-forwarded-for")?.split(",")[0]?.trim() || get("x-real-ip")?.trim() || "";
  if (!ip) return null;
  return createHash("sha256").update(`${ip}::${process.env.WIZARD_IP_SALT ?? "pg-wizard"}`).digest("hex").slice(0, 32);
}

export type OtpSendOutcome =
  | { status: "verified" }
  | { status: "sent"; masked: string; expiresAt: string }
  | { status: "too_soon" | "limited"; waitSeconds: number }
  | { status: "failed"; message: string };

export async function sendOtp(svc: SupabaseClient, input: { userId: string; mobile: string; ipHash: string | null; brand: WizardBrand | null | undefined }): Promise<OtpSendOutcome> {
  const code = newOtpCode();
  const { data, error } = await svc.rpc("wizard_otp_send", { p_user: input.userId, p_mobile: input.mobile, p_code_hash: hashOtp(input.userId, input.mobile, code), p_ip_hash: input.ipHash });
  if (error) return { status: "failed", message: error.message };
  const r = data as { status: string; wait_s?: number; expires_at?: string };
  if (r.status === "verified") return { status: "verified" };
  if (r.status === "too_soon" || r.status === "limited") return { status: r.status, waitSeconds: Math.max(1, Math.ceil(Number(r.wait_s ?? 60))) };
  if (r.status !== "ok" || !r.expires_at) return { status: "failed", message: "The code could not be made." };
  const brandName = brandFor(input.brand === "painthome" ? "painthome" : "home").name;
  const to = normalisePhoneAU(input.mobile) ?? `+61${input.mobile.slice(1)}`;
  const sent = await sendSms({ to, body: otpSmsBody(brandName, code), ctx: { kind: "wizard_otp" } });
  if (sent.status === "error") reportError(new Error(sent.message ?? "gate code text failed"), { where: "wizard.otp.send", extra: { mobile: maskMobile(input.mobile) } });
  return { status: "sent", masked: maskMobile(input.mobile), expiresAt: r.expires_at };
}

export type OtpVerifyOutcome =
  | { status: "ok" }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "ended" | "expired" }
  | { status: "failed"; message: string };

export async function verifyOtp(svc: SupabaseClient, input: { userId: string; mobile: string; code: string }): Promise<OtpVerifyOutcome> {
  const { data, error } = await svc.rpc("wizard_otp_verify", { p_user: input.userId, p_mobile: input.mobile, p_code_hash: hashOtp(input.userId, input.mobile, input.code) });
  if (error) return { status: "failed", message: error.message };
  const r = data as { status: string; attempts_left?: number };
  switch (r.status) {
    case "ok": return { status: "ok" };
    case "wrong": return { status: "wrong", attemptsLeft: Number(r.attempts_left ?? 0) };
    case "ended": return { status: "ended" };
    case "expired":
    case "none": return { status: "expired" };
    default: return { status: "failed", message: "The code could not be checked." };
  }
}

/** The submit route's check. A read that fails is reported and answers false: a guard that cannot see refuses. */
export async function mobileVerified(svc: SupabaseClient, userId: string, mobile: string): Promise<boolean> {
  const { data, error } = await svc.rpc("wizard_otp_verified", { p_user: userId, p_mobile: mobile });
  if (error) { reportError(error, { where: "wizard.otp.verified" }); return false; }
  return data === true;
}
