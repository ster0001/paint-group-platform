import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isMarketingHost } from "@/lib/marketing/hosts";

export async function proxy(request: NextRequest) {
  // The marketing homepage owns `/` only on the website's hosts; on the
  // platform address (paint-group-platform.vercel.app and previews) `/` is
  // the login page, as it was before the homepage shipped (Tom, 5 Sep 2026).
  if (request.nextUrl.pathname === "/" && !isMarketingHost(request.headers.get("host"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return await updateSession(request);
}

export const config = {
  // Run on all routes except static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
