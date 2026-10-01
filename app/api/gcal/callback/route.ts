import { NextResponse } from "next/server";
import { requireContractor } from "@/lib/contractor/session";
import { createServiceClient } from "@/lib/supabase/service";
import { exchangeCode, gcalEnv, verifyState } from "@/lib/gcal/oauth";
import { reconcileContractorCalendar, saveGcalConnection } from "@/lib/gcal/sync";
import { reconcileStaffCalendar, saveStaffConnection } from "@/lib/gcal/staff";
import { forgetGoogleReads } from "@/lib/gcal/read";
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
  // `code` is a short enumerated reason the card turns into a sentence (Tom,
  // 1 Oct: a painter "getting an error message" had nothing to tell us). Only
  // [a-z_] ever reaches the URL.
  const fail = (why: string, code: string) => {
    reportError(new Error(why), { where: "gcal.callback", extra: { code, host: url.host } });
    return NextResponse.redirect(new URL(`${home}?gcal=failed&why=${code.replace(/[^a-z_]/g, "")}`, request.url));
  };

  if (!staffUser && !session?.contractor) return fail("gcal callback without contractors row", "no_session");
  const googleError = url.searchParams.get("error");
  if (googleError) {
    // access_denied is the person pressing Cancel on the consent screen — not
    // an error. Anything else Google sends back is.
    if (googleError === "access_denied") return NextResponse.redirect(new URL(`${home}?gcal=denied`, request.url));
    return fail(`google returned ${googleError}`, `google_${googleError.toLowerCase()}`);
  }

  const env = gcalEnv(url.origin);
  const admin = createServiceClient();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/gcal_oauth_state=([^;]+)/)?.[1] ?? null;

  if (!env || !admin || !code) return fail("gcal callback missing env or code", "missing_env");
  if (!verifyState(env.clientSecret, state) || state !== cookieState) {
    return fail(`gcal callback state mismatch (cookie ${cookieState ? "present" : "absent"})`, cookieState ? "state" : "state_cookie");
  }

  try {
    const tokens = await exchangeCode(code, env.redirectUri);
    if (!tokens.refreshToken) return fail("gcal exchange returned no refresh token", "no_refresh");
    if (staffUser) {
      await saveStaffConnection(admin, staffUser.id, tokens.refreshToken, tokens.email, tokens.scope);
      forgetGoogleReads(staffUser.id);
      await reconcileStaffCalendar(staffUser.id);
    } else {
      await saveGcalConnection(admin, session!.contractor!.id, tokens.refreshToken, tokens.email);
      // First sync now — creates the "Paint Group Jobs" calendar and pushes
      // every accepted booking. Failures are recorded on the connection row and
      // shown on the card; the connection itself still stands.
      await reconcileContractorCalendar(session!.contractor!.id);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "gcal exchange failed", "exchange");
  }

  const res = NextResponse.redirect(new URL(`${home}?gcal=connected`, request.url));
  res.cookies.set("gcal_oauth_state", "", { maxAge: 0, path: "/api/gcal" });
  return res;
}
