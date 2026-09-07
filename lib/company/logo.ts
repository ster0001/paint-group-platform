import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The company logo from Settings → Company (company_profile.logoUrl), or ""
 * when none is uploaded. The staff sidebar has read it this way since the
 * logo upload shipped; the CRM, Projects and Payments shells now wear the
 * same logo in the top-left corner (Tom, 8 Sep) so every screen has the one
 * way home.
 */
export async function loadLogoUrl(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const url = (data?.value as { logoUrl?: unknown } | null)?.logoUrl;
  return typeof url === "string" ? url : "";
}
