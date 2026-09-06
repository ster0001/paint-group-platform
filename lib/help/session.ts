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
export async function helpReader(): Promise<{ kind: "staff" | "contractor"; roles: HelpRole[] } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "staff") return { kind: "staff", roles: rolesFor("staff") };
  if (profile?.role === "contractor") return { kind: "contractor", roles: rolesFor("contractor") };
  return null;
}
