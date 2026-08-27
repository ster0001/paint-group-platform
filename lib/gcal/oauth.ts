// SERVER ONLY — OAuth2 against Google for the contractor calendar sync.
// The client secret lives in server env; nothing here may be imported by
// client components. Same shape as lib/myob/oauth.ts.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * calendar.app.created: the app may CREATE secondary calendars and manage
 * events on those it created — and nothing else. It can never read or write
 * the painter's own calendars, which is both the honest promise the portal
 * makes ("we add a Paint Group Jobs calendar, we can't see your events") and
 * the scope Google doesn't flag as sensitive at consent time.
 * openid email is only so we can show WHICH Google account is connected.
 */
export const GCAL_SCOPE = "openid email https://www.googleapis.com/auth/calendar.app.created";

export function gcalEnv(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/gcal/callback` : null);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/**
 * CSRF state: random nonce + HMAC over it with the client secret. The nonce
 * rides both the authorize URL and an httpOnly cookie; the callback verifies
 * the pair, so a forged callback can't attach someone else's Google account.
 */
export function signState(clientSecret: string, nonce?: string): string {
  const n = nonce ?? randomBytes(16).toString("hex");
  const mac = createHmac("sha256", clientSecret).update(n).digest("hex").slice(0, 32);
  return `${n}.${mac}`;
}

export function verifyState(clientSecret: string, state: string | null): boolean {
  if (!state) return false;
  const dot = state.indexOf(".");
  if (dot <= 0) return false;
  const n = state.slice(0, dot);
  const given = state.slice(dot + 1);
  const want = createHmac("sha256", clientSecret).update(n).digest("hex").slice(0, 32);
  if (given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GCAL_SCOPE,
    state,
    // offline + consent: Google only hands out a refresh token on a consent
    // screen, so force it even when the contractor reconnects.
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${q}`;
}

export type GcalTokens = {
  accessToken: string;
  /** Absent on refresh-grant responses — Google doesn't rotate refresh tokens. */
  refreshToken?: string;
  expiresInSec: number;
  /** From the id_token, display only. */
  email?: string;
};

type RawTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

/** Display-only claim off a token Google just handed us over TLS — no signature check needed. */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return typeof claims.email === "string" ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

/** Thrown when Google says the refresh token is dead (revoked / expired) — reconnect required. */
export class GcalAuthRevoked extends Error {
  constructor() {
    super("google calendar access was revoked — reconnect in the portal");
    this.name = "GcalAuthRevoked";
  }
}

async function tokenRequest(form: Record<string, string>): Promise<GcalTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as RawTokenResponse;
  if (body.error === "invalid_grant") throw new GcalAuthRevoked();
  if (!res.ok || !body.access_token) {
    throw new Error(`gcal token: ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSec: body.expires_in ?? 3600,
    email: emailFromIdToken(body.id_token),
  };
}

export function exchangeCode(code: string): Promise<GcalTokens> {
  const env = gcalEnv();
  if (!env) throw new Error("gcal env missing");
  return tokenRequest({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<GcalTokens> {
  const env = gcalEnv();
  if (!env) throw new Error("gcal env missing");
  return tokenRequest({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Best-effort: tell Google to forget us when the contractor disconnects. */
export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  }).catch(() => undefined);
}
