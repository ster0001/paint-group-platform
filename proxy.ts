import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isMarketingHost } from "@/lib/marketing/hosts";
import { AUDIENCE_HEADER, resolveAudience } from "@/lib/marketing/audience";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  // The marketing homepage owns `/` only on the website's hosts; on the
  // platform address (paint-group-platform.vercel.app and previews) `/` is
  // the login page, as it was before the homepage shipped (Tom, 5 Sep 2026).
  if (request.nextUrl.pathname === "/" && !isMarketingHost(host)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Session 8 §2: the audience, per request, from hostname × path — never a
  // cookie. /business on the residential host has one canonical home on the
  // commercial domain (301); the commercial root serves the business
  // homepage route; every response carries x-audience for the pages.
  const r = resolveAudience(host, request.nextUrl.pathname);
  if (r.redirect) {
    const to = new URL(r.redirect);
    to.search = request.nextUrl.search;
    return NextResponse.redirect(to, 301);
  }
  const res = await updateSession(request, { [AUDIENCE_HEADER]: r.audience }, r.rewrite);
  res.headers.set(AUDIENCE_HEADER, r.audience);
  return res;
}

export const config = {
  // Run on all routes except static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
