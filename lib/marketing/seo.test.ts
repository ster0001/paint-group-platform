import { describe, expect, it } from "vitest";
import { brandIndexable, canonicalUrl, pageSeo } from "./seo";
import { brandFor } from "./brand";
import { legacyRedirectFor } from "./legacyRedirects";
import { resolveAudience } from "./audience";
import { breadcrumbLd, jobItemListLd, localBusinessLd, suburbsServed } from "./structuredData";
import { newestChange, sitemapXml } from "./sitemap";
import { galleryAlt } from "@/lib/showcase/alt";

const ph = brandFor("painthome");

describe("seo.ts — index switch and canonical by brand (SEO foundations, 26 Nov 2026)", () => {
  it("each brand follows its own switch and neither reads the other's", () => {
    expect(brandIndexable("painthome", { PAINTHOME_INDEXABLE: "1" })).toBe(true);
    expect(brandIndexable("painthome", { SITE_INDEXABLE: "1" })).toBe(false);
    expect(brandIndexable("home", { PAINTHOME_INDEXABLE: "1" })).toBe(false);
    expect(brandIndexable("business", { SITE_INDEXABLE: "1" })).toBe(true);
    expect(brandIndexable("painthome", {})).toBe(false);
  });
  it("a Paint Home page names itself on Paint Home's domain", () => {
    expect(canonicalUrl(ph, "/")).toBe("https://painthome.com.au/");
    expect(canonicalUrl(ph, "/work")).toBe("https://painthome.com.au/work");
    expect(canonicalUrl(ph, "work/")).toBe("https://painthome.com.au/work");
    const on = pageSeo("painthome", ph, "/work", { PAINTHOME_INDEXABLE: "1" });
    expect(on.alternates).toEqual({ canonical: "https://painthome.com.au/work" });
    expect(on.robots).toEqual({ index: true, follow: true });
    expect(pageSeo("painthome", ph, "/work", {}).robots).toEqual({ index: false, follow: false });
  });
  it("Paint Group pages get nothing from it: their index settings are not this brief's to change", () => {
    expect(pageSeo("home", brandFor("home"), "/work", { SITE_INDEXABLE: "1", PAINTHOME_INDEXABLE: "1" })).toEqual({});
    expect(pageSeo("business", brandFor("business"), "/work", {})).toEqual({});
  });
});

describe("legacyRedirects.ts — the old WordPress addresses", () => {
  it("each old address has its new home, with or without a trailing slash", () => {
    expect(legacyRedirectFor("/guarantee")).toBe("/warranty");
    expect(legacyRedirectFor("/guarantee/")).toBe("/warranty");
    expect(legacyRedirectFor("/Contact-Us/")).toBe("/#contact");
    expect(legacyRedirectFor("/portfolio")).toBe("/work");
    expect(legacyRedirectFor("/portfolio/kitchens/")).toBe("/work");
    expect(legacyRedirectFor("/blog")).toBe("/");
    expect(legacyRedirectFor("/blog/2019/some-post")).toBe("/");
    expect(legacyRedirectFor("/referral/")).toBe("/");
  });
  it("only whole path segments match, and live pages are never caught", () => {
    for (const p of ["/", "/work", "/work/x", "/warranty", "/estimate", "/blogger", "/portfolios", "/guarantee/extra", "/referral/x"]) expect(legacyRedirectFor(p), p).toBeNull();
  });
  it("the resolver applies it on the Paint Home host only", () => {
    expect(resolveAudience("painthome.com.au", "/guarantee/", null)).toEqual({ audience: "painthome", redirect: "https://painthome.com.au/warranty", rewrite: null });
    expect(resolveAudience("www.painthome.com.au", "/portfolio/houses", null).redirect).toBe("https://painthome.com.au/work");
    expect(resolveAudience("new.paintgroup.com.au", "/guarantee", null)).toEqual({ audience: "home", redirect: null, rewrite: null });
    expect(resolveAudience("painthome.com.au", "/warranty", null).redirect).toBeNull();
  });
});

describe("structuredData.ts", () => {
  const hours = { days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "17:00" };
  it("Paint Home's LocalBusiness: hours, logo, image, email, suburbs, price band; never a rating", () => {
    const ld = localBusinessLd(ph, "Residential painting", "https://painthome.com.au/", { hours, logoUrl: "https://painthome.com.au/painthome/logo-light.png", imageUrl: "https://x/y.jpg", suburbs: ["Malvern East", "Toorak"] }) as Record<string, unknown>;
    expect(ld.email).toBe("hello@painthome.com.au");
    expect(ld.logo).toBe("https://painthome.com.au/painthome/logo-light.png");
    expect(ld.image).toBe("https://x/y.jpg");
    expect(ld.priceRange).toBe("$$");
    expect(ld.openingHoursSpecification).toEqual([{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "17:00" }]);
    expect(ld.areaServed).toEqual([{ "@type": "City", name: "Melbourne" }, { "@type": "Place", name: "Malvern East" }, { "@type": "Place", name: "Toorak" }]);
    expect(ld.sameAs).toBeUndefined(); // no profile address is guessed
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i);
  });
  it("sameAs appears once Settings → Brands holds the addresses", () => {
    const b = brandFor("painthome", { paintgroup: { domain: "", phoneDisplay: "", legalLine: "", primaryColour: "", facebookUrl: "", instagramUrl: "" }, painthome: { domain: "", phoneDisplay: "", legalLine: "", primaryColour: "", facebookUrl: "https://www.facebook.com/example", instagramUrl: "https://www.instagram.com/example" } });
    const ld = localBusinessLd(b, "x", "https://painthome.com.au/", { hours, logoUrl: "l", imageUrl: "i", suburbs: [] }) as Record<string, unknown>;
    expect(ld.sameAs).toEqual(["https://www.facebook.com/example", "https://www.instagram.com/example"]);
  });
  it("Paint Group's block is what it was", () => {
    expect(localBusinessLd(brandFor("home"), "Painting", "https://paintgroup.com.au/")).toEqual({
      "@context": "https://schema.org", "@type": "LocalBusiness", "@id": "https://paintgroup.com.au/#business", name: "Paint Group", telephone: "03 8840 9414",
      areaServed: "Melbourne, Victoria", address: { "@type": "PostalAddress", addressLocality: "Melbourne", addressRegion: "VIC", addressCountry: "AU" }, serviceType: "Painting", url: "https://paintgroup.com.au/",
    });
  });
  it("suburbs: unique, first seen first, no blanks, Melbourne itself not repeated", () => {
    expect(suburbsServed([{ suburb: "Toorak" }, { suburb: " toorak " }, { suburb: "" }, { suburb: "Melbourne" }, { suburb: "Malvern East" }])).toEqual(["Toorak", "Malvern East"]);
  });
  it("breadcrumb and job list are numbered from 1 with absolute addresses", () => {
    expect(breadcrumbLd([{ name: "Paint Home", url: "https://painthome.com.au/" }, { name: "Jobs", url: "https://painthome.com.au/work" }]).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Paint Home", item: "https://painthome.com.au/" },
      { "@type": "ListItem", position: 2, name: "Jobs", item: "https://painthome.com.au/work" },
    ]);
    const list = jobItemListLd("https://painthome.com.au", [{ slug: "a-b", title: "Unit", suburb: "Toorak" }]);
    expect(list.numberOfItems).toBe(1);
    expect(list.itemListElement[0]).toEqual({ "@type": "ListItem", position: 1, name: "Unit in Toorak", url: "https://painthome.com.au/work/a-b" });
  });
});

describe("sitemap.ts", () => {
  it("lastmod is the newest real change, or absent; never invented", () => {
    expect(newestChange(["2026-10-01T02:00:00Z", "2026-11-20T23:30:00+00:00", null, ""])).toBe("2026-11-20T23:30:00.000Z");
    expect(newestChange([null, "", "nonsense"])).toBeNull();
    const xml = sitemapXml([{ loc: "https://painthome.com.au/" }, { loc: "https://painthome.com.au/work?a=1&b=2", lastmod: "2026-11-25" }]);
    expect(xml).toContain("<url><loc>https://painthome.com.au/</loc></url>");
    expect(xml).toContain("<loc>https://painthome.com.au/work?a=1&amp;b=2</loc><lastmod>2026-11-25</lastmod>");
  });
});

describe("galleryAlt — a job photo's description", () => {
  const job = { title: "2 Bedroom Apartment", suburb: "Malvern East" };
  it("a caption leads; without one the stage and position stand in, so no two read the same", () => {
    expect(galleryAlt(job, { caption: "Living room.", kind: "after" }, 2, 3)).toBe("Living room, after painting: 2 Bedroom Apartment in Malvern East");
    const a = galleryAlt(job, { caption: "", kind: "before" }, 0, 3);
    const b = galleryAlt(job, { caption: "", kind: "before" }, 1, 3);
    expect(a).toBe("2 Bedroom Apartment in Malvern East, before painting (photo 1 of 3)");
    expect(a).not.toBe(b);
    expect(galleryAlt(job, { caption: "", kind: "during" }, 0, 1)).toBe("2 Bedroom Apartment in Malvern East, during painting");
  });
});
