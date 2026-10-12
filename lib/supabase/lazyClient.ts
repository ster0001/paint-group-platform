import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser Supabase client, loaded on first use.
 *
 * For the customer wizard's components (/estimate, /estimate/scope), whose
 * every Supabase call already sits in an effect or an async handler. A static
 * import of `./client` puts supabase-js (~60KB gzipped) in the first-load
 * bundle, and Lighthouse charges every byte requested before the page's
 * largest paint to that paint — on a screen that only needs it once the
 * page is interactive. Loaded here it arrives just after hydration instead.
 *
 * Same client as `createClient()` (createBrowserClient is a singleton in the
 * browser), so the session and cookies are shared with everything else.
 */
export async function browserClient(): Promise<SupabaseClient> {
  const { createClient } = await import("./client");
  return createClient();
}
