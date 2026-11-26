import type { Brand } from "./brand";

/**
 * Paint Home SEO foundations (26 Nov 2026) — the schema.org blocks the
 * marketing pages print, built in one pure place so they are unit-tested
 * and no page assembles its own. (VideoObject keeps its own builder,
 * lib/marketing/videoLd.ts.)
 *
 * Deliberately absent, whatever the page: `aggregateRating` and `Review`.
 * The reviews Paint Home shows are Paint Group's Google reviews, so marking
 * them up as Paint Home's would be claiming someone else's rating.
 */
const DAY: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export type LocalBusinessExtras = {
  /** The office hours, from the one clock (lib/messaging/officeHours.ts). */
  hours: { days: readonly string[]; open: string; close: string };
  logoUrl: string;
  imageUrl: string;
  /** Suburbs with a published job on this site, in the order given. */
  suburbs: string[];
};

/** The schema.org LocalBusiness for a brand: Paint Home is its own `@id` under Paint Group's (Paint Home brief §3). */
export function localBusinessLd(brand: Brand, serviceType: string, url: string, extras: LocalBusinessExtras | null = null) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": brand.localBusinessId,
    name: brand.name,
    telephone: brand.phoneDisplay,
    areaServed: extras
      ? [{ "@type": "City", name: "Melbourne" }, ...extras.suburbs.map((name) => ({ "@type": "Place", name }))]
      : "Melbourne, Victoria",
    address: { "@type": "PostalAddress", addressLocality: "Melbourne", addressRegion: "VIC", addressCountry: "AU" },
    serviceType,
    url,
    ...(extras ? {
      email: brand.email,
      logo: extras.logoUrl,
      image: extras.imageUrl,
      openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: extras.hours.days.map((d) => DAY[d] ?? d), opens: extras.hours.open, closes: extras.hours.close }],
      ...(brand.priceRange ? { priceRange: brand.priceRange } : {}),
      ...(brand.sameAs.length ? { sameAs: brand.sameAs } : {}),
    } : {}),
    ...(brand.parentBusinessId ? { parentOrganization: { "@type": "Organization", "@id": brand.parentBusinessId, name: "Paint Group" } } : {}),
  };
}

/** Unique suburbs, first seen first, blanks dropped, compared without case. */
export function suburbsServed(jobs: Array<{ suburb: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const j of jobs) {
    const s = j.suburb.trim();
    const k = s.toLowerCase();
    if (!s || k === "melbourne" || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function breadcrumbLd(crumbs: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
}

/** /work — the job pages in the order the page lists them. */
export function jobItemListLd(base: string, jobs: Array<{ slug: string; title: string; suburb: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: jobs.length,
    itemListElement: jobs.map((j, i) => ({ "@type": "ListItem", position: i + 1, name: `${j.title} in ${j.suburb}`, url: `${base}/work/${j.slug}` })),
  };
}
