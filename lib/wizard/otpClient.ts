/**
 * The gate's one-time code, from the browser: the two calls the shells make
 * (lib/wizard/otp.ts is the server side). Nothing here decides anything —
 * the server's answer is passed back as it is, in one shape.
 */
import type { WizardBrand } from "./brand";

export type OtpSendResult =
  | { status: "sent"; masked: string }
  | { status: "verified" }
  | { status: "too_soon" | "limited"; waitSeconds: number; error: string }
  | { status: "failed"; error: string };

export async function otpSend(mobile: string, brand: WizardBrand | null | undefined): Promise<OtpSendResult> {
  try {
    const res = await fetch("/api/wizard/otp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile, brand: brand ?? null }) });
    const j = (await res.json().catch(() => ({}))) as { status?: string; masked?: string; error?: string; code?: string; waitSeconds?: number };
    if (res.ok && j.status === "sent") return { status: "sent", masked: j.masked ?? "" };
    if (res.ok && j.status === "verified") return { status: "verified" };
    if (res.status === 429 && (j.code === "too_soon" || j.code === "limited")) return { status: j.code, waitSeconds: Math.max(1, Number(j.waitSeconds ?? 60)), error: j.error ?? "Please wait a moment before asking for another code." };
    return { status: "failed", error: j.error ?? "We couldn't send the code just now — please try again." };
  } catch {
    return { status: "failed", error: "We couldn't reach the server — check your connection and try again." };
  }
}

export type OtpVerifyResult = { status: "ok" } | { status: "wrong" | "ended" | "expired" | "failed"; error: string };

export async function otpVerify(mobile: string, code: string): Promise<OtpVerifyResult> {
  try {
    const res = await fetch("/api/wizard/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile, code }) });
    const j = (await res.json().catch(() => ({}))) as { status?: string; error?: string; code?: string };
    if (res.ok && j.status === "ok") return { status: "ok" };
    const kind = j.code === "wrong" || j.code === "ended" || j.code === "expired" ? j.code : "failed";
    return { status: kind, error: j.error ?? "We couldn't check the code just now — please try again." };
  } catch {
    return { status: "failed", error: "We couldn't reach the server — check your connection and try again." };
  }
}
