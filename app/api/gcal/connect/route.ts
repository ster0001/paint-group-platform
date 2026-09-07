import { NextResponse } from "next/server";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { authorizeUrl, GCAL_SCOPE, GCAL_STAFF_SCOPE, gcalEnv, signState } from "@/lib/gcal/oauth";

export const runtime = "nodejs";

/**
 * Kick off the Google OAuth dance from the portal Calendar tab. Contractor-
 * only; the signed state nonce rides an httpOnly cookie so the callback can
 * prove the round-trip started here. Same shape as /api/myob/connect.
 */
export async function GET(request: Request) {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  // P6: the same OAuth client and callback serve staff (Diary → Connect). The
  // callback tells the two apart by the signed-in profile's role, so Google's
  // console needs no second redirect URI.
  const staffFlow = new URL(request.url).searchParams.get("who") === "staff";
  if (staffFlow) {
    const supabase = await createClient();
    if (!(await requireStaff(supabase))) return NextResponse.redirect(new URL("/login", base));
  } else {
    const session = await requireContractor(); // redirects staff/customers/anon away
    if (!session.contractor) return NextResponse.redirect(new URL("/portal", base));
  }

  const env = gcalEnv();
  if (!env) {
    // Friendly bounce — the Calendar card explains it isn't set up yet.
    return NextResponse.redirect(new URL(staffFlow ? "/crm/diary?gcal=unconfigured" : "/portal/calendar?gcal=unconfigured", base));
  }

  const state = signState(env.clientSecret);
  // Staff also ask to READ their own calendars (8 Sep); contractors never do.
  const res = NextResponse.redirect(authorizeUrl(env.clientId, env.redirectUri, state, staffFlow ? GCAL_STAFF_SCOPE : GCAL_SCOPE));
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/gcal",
  });
  return res;
}
