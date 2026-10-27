import "server-only";
import { getAudience } from "@/lib/marketing/audienceServer";
import { brandFor } from "@/lib/marketing/brand";
import type { WizardBrand } from "./brand";

/**
 * Paint Home brief §5: the wizard pages are served under painthome.com.au
 * (⚑ P5), so the request's audience names the brand; a `?brand=painthome`
 * hand-off names it too (a preview on a dev host). Paint Group otherwise.
 */
export async function wizardBrand(param?: string | null): Promise<WizardBrand> {
  if (param === "painthome") return "painthome";
  return (await getAudience()) === "painthome" ? "painthome" : "paintgroup";
}

/** The brand's display name — "Paint Home" on its host, "Paint Group" otherwise — for chrome that names the company (the chat panels). */
export async function wizardBrandName(param?: string | null): Promise<string> {
  const b = await wizardBrand(param);
  return brandFor(b === "painthome" ? "painthome" : "home").name;
}

/** "Get your painting estimate · Paint Home" — the page title in the brand's name. */
export async function wizardTitle(base: string, param?: string | null): Promise<string> {
  const b = await wizardBrand(param);
  return `${base} · ${brandFor(b === "painthome" ? "painthome" : "home").name}`;
}
