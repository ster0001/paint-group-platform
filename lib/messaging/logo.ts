/**
 * Tom, 24 Sep 2026: "the logos seem to be causing issues with emails —
 * sometimes light mode, sometimes dark. I have updated the logo to one with
 * a background; use it for all emails so it works in both."
 *
 * Mail clients in dark mode recolour or invert a transparent logo, so a
 * wordmark that reads on white vanishes on a dark card and vice versa. A
 * logo that carries its OWN background is immune. Settings → Company holds
 * it as `logoUrlEmail`; every email picks its logo through here and nowhere
 * else, falling back to the light-background logo and then the main one, so
 * a company that never uploads an email logo sees no change.
 */
export type CompanyLogoFields = {
  logoUrl?: string | null;
  logoUrlLight?: string | null;
  logoUrlEmail?: string | null;
};

export function emailLogoUrl(company: CompanyLogoFields | null | undefined): string | undefined {
  const pick = company?.logoUrlEmail || company?.logoUrlLight || company?.logoUrl;
  return pick ? pick : undefined;
}
