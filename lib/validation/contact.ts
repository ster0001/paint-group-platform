/**
 * Contact field validation (Tom, 24 Aug close-off): a mobile only saves as a
 * FULL Australian mobile, an email only as a full address. Empty stays
 * allowed — the fields are optional; half-entered is what's refused, because
 * a half number is what makes an SMS silently vanish months later.
 */

/** 04xx xxx xxx (or +61 4xx…): an Australian MOBILE, not just any phone. */
export function isAuMobile(raw: string): boolean {
  const s = raw.replace(/[\s().-]/g, "");
  return /^04\d{8}$/.test(s) || /^\+?614\d{8}$/.test(s);
}

export function isFullEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

/** Null when fine; the message to show when not. */
export function contactFieldProblems(c: { phone?: string | null; email?: string | null }): string | null {
  if (c.phone?.trim() && !isAuMobile(c.phone)) {
    return "That mobile doesn't look like a full Australian mobile (04xx xxx xxx) — fix it or clear the field.";
  }
  if (c.email?.trim() && !isFullEmail(c.email)) {
    return "That email isn't a full address — fix it or clear the field.";
  }
  return null;
}
