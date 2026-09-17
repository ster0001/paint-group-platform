import { createClient } from "@/lib/supabase/server";
import { rolesFor, type HelpRole } from "./content";

// SERVER ONLY.

/**
 * Who is reading help. Unlike the page guards this never redirects: the media
 * route needs a plain answer so it can 404 (never 403 — a role must not be
 * able to learn that a file exists for another role).
 *
 * A suspended contractor still reads help (Phase C ⚑ C-3): the notice page
 * tells them why the rest is closed, and help is how they get back.
 */
export async function helpReader(): Promise<{ kind: "staff" | "contractor" | "employee"; roles: HelpRole[] } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "staff") return { kind: "staff", roles: rolesFor("staff") };
  if (profile?.role === "contractor") {
    // Employed painters: the same login role, a different manual. A missing
    // column (pre-20270153) or a failed read reads as contractor — the
    // capabilities rule.
    const { data: c, error } = await supabase.from("contractors").select("employment_type").eq("profile_id", user.id).maybeSingle();
    const employee = !error && (c as { employment_type?: unknown } | null)?.employment_type === "employee";
    return employee ? { kind: "employee", roles: rolesFor("employee") } : { kind: "contractor", roles: rolesFor("contractor") };
  }
  return null;
}
