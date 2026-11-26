/**
 * The gate's one-time code — the pure, client-safe parts (the server side is
 * lib/wizard/otp.ts, which re-exports these). Nothing here touches the
 * network or node:crypto.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_HOUR = 3;
export const OTP_RESEND_GAP_S = 60;

/** "0412 345 678" | "+61 412 345 678" | "61412345678" → "0412345678"; null when it is not an Australian mobile. */
export function normaliseMobile(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, "");
  const local = /^\+?61(4\d{8})$/.exec(s)?.[1] ?? (/^0(4\d{8})$/.exec(s)?.[1] ?? null);
  return local ? `0${local}` : null;
}

/** "0412345678" → "0412 ••• 678" — the screen never shows the middle. */
export function maskMobile(digits: string): string {
  const d = digits.replace(/\D/g, "");
  return `${d.slice(0, 4)} ••• ${d.slice(-3)}`;
}

/** The text, word for word (the brief): "Your Paint Group code is 123456. It expires in 10 minutes." */
export function otpSmsBody(brandName: string, code: string): string {
  return `Your ${brandName} code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`;
}

/** Seconds left before "Send it again" may be tapped (60 s after the last send). */
export function resendWaitSeconds(sentAt: number | null, now = Date.now()): number {
  if (sentAt == null) return 0;
  return Math.max(0, Math.ceil((sentAt + OTP_RESEND_GAP_S * 1000 - now) / 1000));
}

/**
 * The details step, said field by field (go-live check, 25 Nov 2026: one
 * line — "Please fill in your name, email and mobile number" — was shown
 * with all three filled in). Null when the three are good; otherwise the
 * FIRST thing wrong and which field it is, so the screen can say it where
 * the customer is looking. The server checks again.
 */
export type GateField = "name" | "email" | "phone";
export function gateContactProblem(c: { name: string; email: string; phone: string }): { field: GateField; message: string } | null {
  if (c.name.trim().length < 2) return { field: "name", message: "Please enter your full name." };
  if (!c.email.trim()) return { field: "email", message: "Please enter your email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())) return { field: "email", message: "Please enter a valid email address, like name@example.com." };
  const raw = c.phone.replace(/[\s().-]/g, "");
  if (!raw) return { field: "phone", message: "Please enter your mobile number." };
  if (!normaliseMobile(c.phone)) {
    return /^0[2378]\d{8}$/.test(raw) || /^\+?61[2378]\d{8}$/.test(raw)
      ? { field: "phone", message: "That looks like a landline. We need a mobile number to text your code." }
      : { field: "phone", message: "Please enter an Australian mobile number, starting 04." };
  }
  return null;
}
