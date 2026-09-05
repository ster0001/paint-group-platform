import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs on every request: keeps the user's Supabase session fresh by reading and
// re-writing the auth cookies. Without this, logins would silently expire.
export async function updateSession(request: NextRequest, extraHeaders: Record<string, string> = {}, rewriteTo: string | null = null) {
  // The staff layouts read x-pathname to gate hidden areas (lib/staff/gate.ts);
  // a server layout cannot see the URL any other way. Built fresh each time
  // so the refreshed auth cookies below travel with it. `extraHeaders`
  // (x-audience, session 8) ride the same way; `rewriteTo` serves another
  // path for this request (the commercial root → /business).
  const withPath = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", request.nextUrl.pathname);
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    return { request: { headers } };
  };
  const next = () => {
    if (!rewriteTo) return NextResponse.next(withPath());
    const url = request.nextUrl.clone();
    url.pathname = rewriteTo;
    return NextResponse.rewrite(url, withPath());
  };
  let supabaseResponse = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = next();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: refreshes the session. Do not add code between this and the return.
  await supabase.auth.getUser();

  return supabaseResponse;
}
