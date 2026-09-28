/**
 * Is this PostgREST error "the function isn't there"? Only then does a screen
 * say "run migration N first". Tom, 29 Sep 2026: a permission or runtime error
 * that merely MENTIONED the function name was shown as a missing migration,
 * which sent him back to a paste that had already run. PostgREST words the
 * genuine case as "Could not find the function public.x(...) in the schema
 * cache" (PGRST202); Postgres as "function public.x(...) does not exist".
 */
export function isMissingRpc(message: string | null | undefined, fn: string): boolean {
  const m = message ?? "";
  return m.includes(fn) && /could not find the function|does not exist|schema cache/i.test(m);
}
