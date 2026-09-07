import { NextResponse } from "next/server";
import { requireContractor } from "@/lib/contractor/session";
import { createServiceClient } from "@/lib/supabase/service";
import { exchangeCode, gcalEnv, verifyState } from "@/lib/gcal/oauth";
import { reconcileContractorCalendar, saveGcalConnection } from "@/lib/gcal/sync";
import { reconcileStaffCalendar, saveStaffConnection } from "@/lib/gcal/staff";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * Google sends the contractor back here with a one-time code. Verify the
 * state round-trip, swap the code for tokens, store the connection against
 * THIS contractor's row, then run the first reconcile so their existing
 * bookings appear in Google before the page even loads.
 */
export async function GET(request: Request) {
  // P6: a signed-in STAFF member lands here from the Diary; a contractor from
  // the portal. Same code, different rows.
  const supabase = await createClient();
  const staffUser = await requireStaff(supabase);
  const session = staffUser ? null : await requireContractor();
  const home = staffUser ? "/crm/diary" : "/portal/calendar";

  const url = new URL(request.url);
  const fail = (why: string, tag = "failed") => {
    reportError(new Error(why), { where: "gcal.callback" });
    return NextResponse.redirect(new URL(`${home}?gcal=${tag}`, request.url));
  };

  if (!staffUser && !session?.contractor) return fail("gcal callback without contractors row");
  if (url.searchParams.get("error")) {
    // Cancel on Google's consent screen — not an error.
    return NextResponse.redirect(new URL(`${home}?gcal=denied`, request.url));
  }

  const env = gcalEnv();
  const admin = createServiceClient();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/gcal_oauth_state=([^;]+)/)?.[1] ?? null;

  if (!env || !admin || !code) return fail("gcal callback missing env or code");
  if (!verifyState(env.clientSecret, state) || state !== cookieState) {
    return fail("gcal callback state mismatch");
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refreshToken) return fail("gcal exchange returned no refresh token");
    if (staffUser) {
      await saveStaffConnection(admin, staffUser.id, tokens.refreshToken, tokens.email);
      await reconcileStaffCalendar(staffUser.id);
    } else {
      await saveGcalConnection(admin, session!.contractor!.id, tokens.refreshToken, tokens.email);
      // First sync now — creates the "Paint Group Jobs" calendar and pushes
      // every accepted booking. Failures are recorded on the connection row and
      // shown on the card; the connection itself still stands.
      await reconcileContractorCalendar(session!.contractor!.id);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "gcal exchange failed");
  }

  const res = NextResponse.redirect(new URL(`${home}?gcal=connected`, request.url));
  res.cookies.set("gcal_oauth_state", "", { maxAge: 0, path: "/api/gcal" });
  return res;
}
