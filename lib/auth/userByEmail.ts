import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The auth user behind an email — ONE implementation for the app and the
 * scripts. SERVER ONLY: it needs the service client.
 *
 * `auth.admin` has no lookup-by-email. `listUsers({ perPage: N })` + `.find()`
 * reads page 1 only, and GoTrue lists NEWEST first, so the oldest logins —
 * seeded staff, long-standing customers — are the first to fall off once the
 * wizard's anonymous users push a project past N. On 11 Oct 2026 that broke
 * every e2e visit spec on C1; the Team invite's fallback had the same cliff
 * on production. Paging with a cap only moves the cliff.
 *
 * `generateLink` answers for one email in one request and sends nothing (the
 * token it mints is discarded). `recovery`, NOT `magiclink`: an unknown email
 * answers 404 `user_not_found`, where a magic link would CREATE the user — a
 * lookup must never write one. Side effect to know about: the recovery token
 * it mints replaces any recovery token already issued for that login, so look
 * up BEFORE sending someone a link, not after.
 *
 * Every outcome is distinct: "nobody has that email" is never the same answer
 * as "the lookup failed" (CLAUDE.md, the list read that drops its error).
 *
 * No imports with runtime weight beyond zod: the .mjs seed scripts import this
 * file directly under Node's type stripping.
 */

export type AuthUserLookup =
  | { status: "found"; user: User }
  | { status: "not_found" }
  | { status: "invalid_email" }
  | { status: "error"; message: string };

const emailSchema = z.string().trim().toLowerCase().email().max(320);

type AdminLinkClient = { auth: { admin: Pick<SupabaseClient["auth"]["admin"], "generateLink"> } };

export async function lookupAuthUserByEmail(svc: AdminLinkClient, email: string): Promise<AuthUserLookup> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { status: "invalid_email" };
  const { data, error } = await svc.auth.admin.generateLink({ type: "recovery", email: parsed.data });
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") return { status: "not_found" };
    return { status: "error", message: error.message || "auth lookup failed" };
  }
  const user = data?.user ?? null;
  if (!user) return { status: "error", message: "auth lookup returned no user" };
  return { status: "found", user };
}

/**
 * For scripts and teardowns: the id, null when nobody has that email, and a
 * THROW for anything else — a failed lookup must not read as "not there".
 */
export async function authUserIdByEmail(svc: AdminLinkClient, email: string): Promise<string | null> {
  const r = await lookupAuthUserByEmail(svc, email);
  if (r.status === "found") return r.user.id;
  if (r.status === "not_found") return null;
  if (r.status === "invalid_email") throw new Error(`authUserIdByEmail: "${email}" is not an email address`);
  throw new Error(`authUserIdByEmail(${email}): ${r.message}`);
}
