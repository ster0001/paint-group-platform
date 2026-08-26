// SERVER ONLY — OAuth2 against MYOB's identity service. The client secret
// lives in server env; nothing here may be imported by client components.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZE_URL = "https://secure.myob.com/oauth2/account/authorize";
const TOKEN_URL = "https://secure.myob.com/oauth2/v1/authorize";

export function myobEnv(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.MYOB_CLIENT_ID;
  const clientSecret = process.env.MYOB_CLIENT_SECRET;
  const site = process.env.MYOB_REDIRECT_URI
    || (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/myob/callback` : null);
  if (!clientId || !clientSecret || !site) return null;
  return { clientId, clientSecret, redirectUri: site };
}

/**
 * CSRF state: random nonce + HMAC over it with the client secret. The nonce
 * rides both the authorize URL and an httpOnly cookie; the callback verifies
 * the pair, so a forged callback can't attach someone else's MYOB account.
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
    scope: "CompanyFile",
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

export type MyobTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user?: string;
};

type RawTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { username?: string };
  error?: string;
  error_description?: string;
};

async function tokenRequest(form: Record<string, string>): Promise<MyobTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as RawTokenResponse;
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(`myob token: ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSec: body.expires_in ?? 1200,
    user: body.user?.username,
  };
}

export function exchangeCode(code: string): Promise<MyobTokens> {
  const env = myobEnv();
  if (!env) throw new Error("myob env missing");
  return tokenRequest({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
  });
}

/** MYOB rotates the refresh token on every use — the caller MUST persist it. */
export function refreshTokens(refreshToken: string): Promise<MyobTokens> {
  const env = myobEnv();
  if (!env) throw new Error("myob env missing");
  return tokenRequest({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
