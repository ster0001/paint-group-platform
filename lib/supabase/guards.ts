import type { SupabaseClient, User } from "@supabase/supabase-js";

// SERVER ONLY.

/**
 * The one place a route decides who is calling it. Two kinds of actor:
 *
 *   staff     a signed-in user whose profile role is "staff" — full access,
 *             RLS does the real enforcement.
 *   customer  an ANONYMOUS-auth visitor in the customer wizard (Step 8).
 *             They hold a real auth.uid() but zero direct table access;
 *             routes act for them through the service client with explicit
 *             ownership checks.
 *
 * Everything else is nobody.
 */

export type WizardActor =
  | { kind: "staff"; user: User }
  | { kind: "customer"; user: User }
  | { kind: "none" };

export async function getWizardActor(supabase: SupabaseClient): Promise<WizardActor> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "staff") return { kind: "staff", user };
  // An anonymous-auth visitor has no profile row; a signed-in customer or
  // contractor has one with a non-staff role. Only true anonymous wizard
  // sessions count as the customer actor — an authenticated contractor
  // poking the wizard routes is "none".
  const anonymous = (user as User & { is_anonymous?: boolean }).is_anonymous === true;
  if (anonymous) return { kind: "customer", user };
  return { kind: "none" };
}

/** The staff gate, shared. Returns the user or null (route 401/403s). */
export async function requireStaff(supabase: SupabaseClient): Promise<User | null> {
  const actor = await getWizardActor(supabase);
  return actor.kind === "staff" ? actor.user : null;
}
