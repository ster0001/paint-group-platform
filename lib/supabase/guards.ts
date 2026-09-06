import type { SupabaseClient, User } from "@supabase/supabase-js";

// SERVER ONLY.

/**
 * The one place a route decides who is calling it. Two kinds of actor:
 *
 *   staff     a signed-in user whose profile role is "staff" — full access,
 *             RLS does the real enforcement.
 *   customer  a wizard customer: either an ANONYMOUS-auth visitor (Step 8)
 *             or, since 3a-6, a SIGNED-IN portal customer (magic-link login,
 *             profile role "customer") using the embedded builder. Both hold
 *             a real auth.uid() and zero direct wizard-table access; routes
 *             act for them through the service client with explicit
 *             created_by ownership checks, which cover both identically.
 *             `verifiedEmail` is set ONLY for the signed-in kind — a
 *             clicked magic link proved that inbox; a typed email proves
 *             nothing.
 *
 * Everything else (contractors included) is nobody.
 */

export type WizardActor =
  | { kind: "staff"; user: User }
  | { kind: "customer"; user: User; verifiedEmail: string | null }
  | { kind: "none" };

export async function getWizardActor(supabase: SupabaseClient): Promise<WizardActor> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "staff") return { kind: "staff", user };
  const anonymous = (user as User & { is_anonymous?: boolean }).is_anonymous === true;
  if (anonymous) return { kind: "customer", user, verifiedEmail: null };
  // 3a-6: a signed-in portal customer runs the SAME wizard as the public —
  // their session email is the identity, so the email gate can be skipped.
  if (profile?.role === "customer" && user.email) {
    return { kind: "customer", user, verifiedEmail: user.email.toLowerCase() };
  }
  return { kind: "none" };
}

/** The staff gate, shared. Returns the user or null (route 401/403s). */
export async function requireStaff(supabase: SupabaseClient): Promise<User | null> {
  const actor = await getWizardActor(supabase);
  return actor.kind === "staff" ? actor.user : null;
}

/**
 * Phase 1 (6 Sep plan): may this CUSTOMER open and edit this draft?
 *
 * Two doors, both to a draft only:
 *   · the anonymous session that built it (created_by, source customer_intake)
 *     — the wizard's original rule;
 *   · a signed-in member of the account the estimate is linked to — the
 *     magic-link owner coming back on another device, or later.
 * Membership is read through the service client the callers already hold;
 * account_users rows only ever come from verified sign-ins (3a-1), so a
 * typed email never opens anyone else's estimate.
 */
export async function customerOwnsDraft(
  db: SupabaseClient,
  actor: Extract<WizardActor, { kind: "customer" }>,
  estimate: { created_by?: string | null; source?: string | null; status?: string | null; account_id?: string | null },
): Promise<boolean> {
  if (estimate.status !== "draft") return false;
  if (estimate.created_by === actor.user.id && estimate.source === "customer_intake") return true;
  if (!actor.verifiedEmail || !estimate.account_id) return false;
  const { data } = await db
    .from("account_users")
    .select("account_id")
    .eq("profile_id", actor.user.id)
    .eq("account_id", estimate.account_id)
    .maybeSingle();
  return Boolean(data);
}
