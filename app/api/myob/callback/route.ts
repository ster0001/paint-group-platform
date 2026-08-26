import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { exchangeCode, myobEnv, verifyState } from "@/lib/myob/oauth";
import { listCompanyFiles, saveConnection } from "@/lib/myob/client";
import type { MyobConnection } from "@/lib/myob/config";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * MYOB sends the staff member back here with a one-time code. Verify the
 * state round-trip, swap the code for tokens, store the connection, and if
 * the login can only see ONE business, pick it automatically.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const env = myobEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/myob_oauth_state=([^;]+)/)?.[1] ?? null;

  const fail = (why: string) => {
    reportError(new Error(why), { where: "myob.callback" });
    return NextResponse.redirect(new URL("/settings?myob=failed", request.url));
  };

  if (!env || !code) return fail("myob callback missing env or code");
  if (!verifyState(env.clientSecret, state) || state !== cookieState) {
    return fail("myob callback state mismatch");
  }

  try {
    const tokens = await exchangeCode(code);
    const conn: MyobConnection = {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: new Date(Date.now() + tokens.expiresInSec * 1000).toISOString(),
      companyFile: null,
      connectedAt: new Date().toISOString(),
      myobUser: tokens.user,
    };
    // One visible business → no pointless picker step.
    const files = await listCompanyFiles(conn).catch(() => []);
    if (files.length === 1) conn.companyFile = files[0];
    await saveConnection(supabase, conn);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "myob exchange failed");
  }

  const res = NextResponse.redirect(new URL("/settings?myob=connected", request.url));
  res.cookies.set("myob_oauth_state", "", { maxAge: 0, path: "/api/myob" });
  return res;
}
