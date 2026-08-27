import { NextResponse } from "next/server";
import { requireContractor } from "@/lib/contractor/session";
import { authorizeUrl, gcalEnv, signState } from "@/lib/gcal/oauth";

export const runtime = "nodejs";

/**
 * Kick off the Google OAuth dance from the portal Calendar tab. Contractor-
 * only; the signed state nonce rides an httpOnly cookie so the callback can
 * prove the round-trip started here. Same shape as /api/myob/connect.
 */
export async function GET() {
  const session = await requireContractor(); // redirects staff/customers/anon away
  if (!session.contractor) {
    return NextResponse.redirect(new URL("/portal", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  }

  const env = gcalEnv();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (!env) {
    // Friendly bounce — the Calendar card explains it isn't set up yet.
    return NextResponse.redirect(new URL("/portal/calendar?gcal=unconfigured", base));
  }

  const state = signState(env.clientSecret);
  const res = NextResponse.redirect(authorizeUrl(env.clientId, env.redirectUri, state));
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/gcal",
  });
  return res;
}
