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

/** 0[2378]xx xxx xxx (or +61 [2378]…): an Australian LANDLINE — never a text destination. */
export function isAuLandline(raw: string): boolean {
  const s = raw.replace(/[\s().-]/g, "");
  return /^0[2378]\d{8}$/.test(s) || /^\+?61[2378]\d{8}$/.test(s);
}

export function isFullEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

/** Null when fine; the message to show when not. */
export function contactFieldProblems(c: {
  phone?: string | null; email?: string | null;
  landline?: string | null; secondary_email?: string | null; secondary_phone?: string | null;
}): string | null {
  if (c.phone?.trim() && !isAuMobile(c.phone)) {
    return "That mobile doesn't look like a full Australian mobile (04xx xxx xxx) — fix it or clear the field.";
  }
  if (c.email?.trim() && !isFullEmail(c.email)) {
    return "That email isn't a full address — fix it or clear the field.";
  }
  // Tom, 29 Sep: the landline and the second person follow the same rule —
  // a half number saves nothing.
  if (c.landline?.trim() && !isAuLandline(c.landline) && !isAuMobile(c.landline)) {
    return "That landline doesn't look like a full Australian number (0x xxxx xxxx) — fix it or clear the field.";
  }
  if (c.secondary_phone?.trim() && !isAuMobile(c.secondary_phone)) {
    return "The second contact's mobile doesn't look like a full Australian mobile (04xx xxx xxx) — fix it or clear the field.";
  }
  if (c.secondary_email?.trim() && !isFullEmail(c.secondary_email)) {
    return "The second contact's email isn't a full address — fix it or clear the field.";
  }
  return null;
}
