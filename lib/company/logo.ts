import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The company logos from Settings → Company (company_profile): `logoUrl` is
 * the main one — white lettering for a dark header — and `logoUrlLight` the
 * dark-lettering one for light backgrounds (email, the quote PDF). Tom, 8 Sep:
 * in light mode every staff surface shows the dark-lettering logo, in dark
 * mode the light one. Either may be empty; "" means the text mark.
 */
export type CompanyLogos = { onDark: string; onLight: string };

export async function loadLogos(supabase: SupabaseClient): Promise<CompanyLogos> {
  const { data } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const v = (data?.value ?? {}) as { logoUrl?: unknown; logoUrlLight?: unknown };
  const onDark = typeof v.logoUrl === "string" ? v.logoUrl : "";
  const onLight = typeof v.logoUrlLight === "string" && v.logoUrlLight ? v.logoUrlLight : onDark;
  return { onDark, onLight };
}

/** The main (dark-header) logo alone, for surfaces that are always dark. */
export async function loadLogoUrl(supabase: SupabaseClient): Promise<string> {
  return (await loadLogos(supabase)).onDark;
}
