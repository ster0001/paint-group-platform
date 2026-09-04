/**
 * Cookie consent (Tom, 4 Sep): a bottom sheet with two buttons —
 * `Only what's needed` (the default, the quieter one) and `Allow analytics`
 * — the choice kept in a FIRST-PARTY cookie for 12 months, reopenable from
 * "Cookie settings" in the footer. Microsoft Clarity loads only after
 * "Allow analytics", never before, under any condition. The platform's own
 * events table needs no consent (first-party, no PII beyond the address,
 * which travels only on see_price).
 *
 * Pure helpers here (tested); the sheet and the loaders are components.
 */
export const CONSENT_COOKIE = "pg_consent";
export const VISITOR_COOKIE = "pg_vid";
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60; // 12 months

export type Consent = "essential" | "analytics";

export function parseConsent(cookieHeader: string | null | undefined): Consent | null {
  const v = readCookie(cookieHeader, CONSENT_COOKIE);
  return v === "essential" || v === "analytics" ? v : null;
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The Set-Cookie / document.cookie string for a choice. */
export function consentCookie(choice: Consent, secure = true): string {
  return `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function visitorCookie(id: string, secure = true): string {
  return `${VISITOR_COOKIE}=${id}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** A visitor id: random, first-party, meaningless outside this site. */
export function newVisitorId(random: () => string = () => crypto.randomUUID()): string {
  return random().replace(/-/g, "").slice(0, 32);
}
