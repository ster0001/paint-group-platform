import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isMarketingHost } from "@/lib/marketing/hosts";
import { AUDIENCE_HEADER, resolveAudience } from "@/lib/marketing/audience";
import { allowTokenRoute, clientIpFromHeaders, isTokenRoutePath } from "@/lib/security/tokenRouteLimit";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  // CLAUDE.md: token routes are rate-limited. One shared per-IP budget across
  // every /<door>/[token] path (lib/security/tokenRouteLimit.ts) — a brake on
  // token guessing and runaway scripts, answered before any database work.
  if (isTokenRoutePath(request.nextUrl.pathname)
      && !allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) {
    return new NextResponse("Too many requests — please wait a minute and try again.", {
      status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
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
