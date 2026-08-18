import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// SERVER ONLY. Never import from anything under a client component or
// app/**/client — CLAUDE.md: the service-role key exists only in server env.

/**
 * The service-role client, for the CUSTOMER WIZARD routes only.
 *
 * Why it exists (Step 8): anonymous visitors have no RLS-granted table
 * access — deliberately. Their reads and writes are mediated entirely by
 * server routes, which use this client plus EXPLICIT ownership checks
 * against the caller's auth.uid(). In particular the rate card (production
 * rates, charge-outs) is priced server-side and never exposed to a
 * customer's browser session.
 *
 * Rules of use, enforced by review rather than types:
 *   - Only in app/api/** route handlers and server components.
 *   - Every query it runs on customer behalf must be scoped by an ownership
 *     or guardrail check the route itself performs.
 *   - Staff flows keep using the caller-session client + RLS as before.
 */
export function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
