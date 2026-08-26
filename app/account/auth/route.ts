import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureMembership, safeNextPath } from "@/lib/portal/auth";
import { reportError } from "@/lib/monitoring/report";

/**
 * 3a-2 · The magic-link landing. Clicking the emailed link proves possession
 * of the inbox: verifyOtp turns the single-use token into a session, and only
 * then does the login join its account (the 3a-1 membership ruling).
 *
 * Failure is never a dead end — expired/used links land on the login page
 * with a plain explanation and a one-tap resend.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash") ?? "";
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (!tokenHash || tokenHash.length > 300) {
    return NextResponse.redirect(new URL("/account/login?error=link", request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });

  if (error || !data.user?.email) {
    return NextResponse.redirect(new URL("/account/login?error=link", request.url));
  }

  try {
    await ensureMembership(data.user.id, data.user.email);
  } catch (err) {
    // Membership is retried on the next visit by the portal gate — a hiccup
    // here must not cost the customer their sign-in.
    reportError(err, { where: "account.auth.membership", bestEffort: true });
  }

  return NextResponse.redirect(new URL(next, request.url));
}
