import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { authorizeUrl, myobEnv, signState } from "@/lib/myob/oauth";

export const runtime = "nodejs";

/**
 * Kick off the MYOB OAuth dance. Staff-only; the signed state nonce rides an
 * httpOnly cookie so the callback can prove the round-trip started here.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const env = myobEnv();
  if (!env) {
    // Friendly bounce — the Settings card explains which env keys are missing.
    return NextResponse.redirect(new URL("/settings?myob=unconfigured", request.url));
  }

  const state = signState(env.clientSecret);
  const res = NextResponse.redirect(authorizeUrl(env.clientId, env.redirectUri, state));
  res.cookies.set("myob_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/myob",
  });
  return res;
}
