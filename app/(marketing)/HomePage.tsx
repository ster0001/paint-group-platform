import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Nav from "./_sections/Nav";
import Hero from "./_sections/Hero";
import HowItWorks from "./_sections/HowItWorks";
import RealJobs from "./_sections/RealJobs";
import PromiseSection from "./_sections/Promise";
import Story from "./_sections/Story";
import LiveStrip from "./_sections/LiveStrip";
import Painters from "./_sections/Painters";
import Trade from "./_sections/Trade";
import Reviews from "./_sections/Reviews";
import Faq from "./_sections/Faq";
import ClosingCta from "./_sections/ClosingCta";
import Footer from "./_sections/Footer";
import CallBar from "./_sections/CallBar";
import { AudienceProvider } from "./_components/Audience";
import { faqJsonLd, type FaqEntry } from "@/lib/marketing/faq";
import { getSiteLogo, getWebsiteContent } from "@/lib/marketing/siteContent";
import { getSiteCopy } from "@/lib/marketing/siteCopy";
import { audiencePrefix, commercialDomain, otherAudienceHref, residentialOrigin, type Audience } from "@/lib/marketing/audience";
import { text } from "@/lib/marketing/copy";
import type { SiteCopy } from "@/lib/marketing/copy/schema";
import { brandView, type Brand } from "@/lib/marketing/brand";
import { getBrand } from "@/lib/marketing/brandServer";
import type { GhostExample } from "@/lib/marketing/ghostEstimator";
import { isScope } from "@/lib/marketing/estimateLink";
import { policyFromSettings } from "@/lib/wizard/policy";
import { getSettingValue } from "@/lib/marketing/brandServer";

/**
 * Session 8 — ONE homepage, two audiences. `app/(marketing)/page.tsx`
 * renders it for homes and `app/(marketing)/business/page.tsx` for
 * businesses (the commercial domain's root is rewritten there by the
 * proxy), so both stay static with ISR. Every string comes from
 * site_content (lib/marketing/siteCopy) or the showcase table or Google;
 * the section ORDER is the one thing decided here: the trade lane is
 * promoted to sit straight after the jobs on the business site (§4).
 *
 * Paint Home (docs/briefs/paint-home.md) is the THIRD audience, rendered by
 * `painthome/page.tsx` (painthome.com.au's root is rewritten there). Same
 * sections, same components; what differs is the BRAND (lib/marketing/
 * brand.ts → nav, footer, metadata, schema, phone, the `[data-brand]`
 * palette) and, from Session 2, the words. No trade lane, no link to the
 * business site (§4).
 */
// Both routes declare `export const revalidate = 60` themselves (Next needs a literal there).

function copyFor(c: SiteCopy, audience: Audience) {
  const t = (s: Parameters<typeof text>[1], k: string) => text(c, s, k);
  // The self-typing examples carry the wizard MODE; Paint Home is residential only.
  const mode: GhostExample["mode"] = audience === "business" ? "business" : "home";
  const examples: GhostExample[] = [1, 2, 3, 4]
    .map((n) => {
      const sc = t("estimator_examples", `example_${n}_scope`);
      return { address: t("estimator_examples", `example_${n}_address`), price: t("estimator_examples", `example_${n}_price`), time: t("estimator_examples", `example_${n}_time`), mode, ...(isScope(sc) ? { scope: sc } : {}) };
    })
    .filter((e) => e.address && e.price);
  const labels = { placeholder: t("hero", "placeholder"), button: t("hero", "button"), chipsLabel: t("hero", "chips_label"), chipHome: t("hero", "chip_home"), chipBusiness: t("hero", "chip_business"), chipInterior: t("hero", "chip_interior"), chipExterior: t("hero", "chip_exterior") };
  // Paint Home: the nav has no "For business" link and no link to the
  // other site (brief §4). The link set is the copy's until Session 2
  // seeds Paint Home's own; the one pointing at the trade lane is dropped
  // here because the lane is not on the page.
  const navLinks = [1, 2, 3, 4].map((n) => ({ label: t("nav", `link_${n}_label`), href: t("nav", `link_${n}_href`) })).filter((l) => l.label && l.href)
    .filter((l) => audience !== "painthome" || l.href !== "#trade");
  return {
    hero: { kicker: t("hero", "kicker"), h1Lines: t("hero", "h1").split("\n").map((l) => l.trim()).filter(Boolean), lead: t("hero", "lead"), talkLine: t("hero", "talk_line"), labels, examples },
    steps: { h2: t("how_it_works", "h2"), steps: [1, 2, 3, 4].map((n) => ({ title: t("how_it_works", `step_${n}_title`), body: t("how_it_works", `step_${n}_body`) })), talkLine: t("how_it_works", "talk_line") },
    jobs: { kicker: t("jobs", "kicker"), h2: t("jobs", "h2"), lead: t("jobs", "lead"), allLink: t("jobs", "all_link") },
    promise: { kicker: t("promise", "kicker"), h2: t("promise", "h2"), lead: t("promise", "lead"), panelKicker: t("promise", "panel_kicker"),
      rows: [1, 2, 3, 4].map((n) => ({ title: t("promise", `row_${n}_title`), sub: t("promise", `row_${n}_sub`), heading: t("promise", `row_${n}_heading`), note: t("promise", `row_${n}_note`) })) },
    story: { kicker: t("story", "kicker"), h2: t("story", "h2"), lead: t("story", "lead"), phoneAddress: t("story", "phone_address"), phoneMeta: t("story", "phone_meta"), signedLine: t("story", "signed_line"),
      captions: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => t("story", `beat_${n}`)), businessBeat: audience === "business" ? t("story", "beat_9") || null : null },
    live: t("live", "heading"),
    painters: { h2: t("painters", "h2"), lead: t("painters", "lead"), rules: [1, 2, 3, 4].map((n) => t("painters", `rule_${n}`)) },
    trade: { kicker: t("trade", "kicker"), h2: t("trade", "h2"), lead: t("trade", "lead"), cta1: t("trade", "cta_1"), cta2: t("trade", "cta_2") },
    reviews: { h2: t("reviews", "h2"), fallbackH2: t("reviews", "fallback_h2"), lead: t("reviews", "lead") },
    faq: { h2: t("faq", "h2"), entries: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ q: t("faq", `q_${n}`), a: t("faq", `a_${n}`) })).filter((e) => e.q) as FaqEntry[] },
    cta: { h2: t("cta", "h2"), callLine: t("cta", "call_line"), labels },
    nav: {
      links: navLinks,
      otherLabel: audience === "painthome" ? "" : t("nav", "other_audience_label"), otherHref: otherAudienceHref(audience), cta: t("nav", "cta"), prefix: audiencePrefix(audience),
    },
    meta: { title: t("meta", "title_tag"), description: t("meta", "meta_description"), serviceType: t("meta", "service_type") },
  };
}

/** Paint Home's index switch is its own (brief §7): PAINTHOME_INDEXABLE=1, independent of SITE_INDEXABLE. */
const paintHomeIndexable = () => process.env.PAINTHOME_INDEXABLE === "1";

export async function homeMetadata(audience: Audience): Promise<Metadata> {
  const [siteCopy, brand] = await Promise.all([getSiteCopy(audience), getBrand(audience)]);
  const c = copyFor(siteCopy, audience);
  if (audience === "painthome") {
    return {
      title: c.meta.title,
      description: c.meta.description,
      // §7: its own canonical, OG image and index switch; the images resolve against its domain.
      metadataBase: new URL(brand.url),
      alternates: { canonical: `${brand.url}/` },
      robots: { index: paintHomeIndexable(), follow: paintHomeIndexable() },
    };
  }
  return {
    title: c.meta.title,
    description: c.meta.description,
    // §7: canonicals are self-referential per domain; the proxy keeps each URL on one domain.
    alternates: { canonical: audience === "business" && commercialDomain() ? `https://${commercialDomain()}/` : audiencePrefix(audience) || "/" },
  };
}

/** The schema.org LocalBusiness for a brand: Paint Home is its own `@id` under Paint Group's (brief §3). */
export function localBusinessLd(brand: Brand, serviceType: string, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": brand.localBusinessId,
    name: brand.name,
    telephone: brand.phoneDisplay,
    areaServed: "Melbourne, Victoria",
    address: { "@type": "PostalAddress", addressLocality: "Melbourne", addressRegion: "VIC", addressCountry: "AU" },
    serviceType,
    url,
    ...(brand.parentBusinessId ? { parentOrganization: { "@type": "Organization", "@id": brand.parentBusinessId, name: "Paint Group" } } : {}),
  };
}

export default async function HomePage({ audience }: { audience: Audience }) {
  const [content, logoUrl, siteCopy, brand, policyRow] = await Promise.all([getWebsiteContent(), getSiteLogo(), getSiteCopy(audience), getBrand(audience), audience === "painthome" ? getSettingValue("wizard_policy") : Promise.resolve(null)]);
  // Paint Home brief §4–5: its cards never exceed the phone-close tier — the
  // Settings value wizard_policy.paintHomeCapCents (its own number since 27 Oct 2026; ⚑ P7 had tied it to the remote-confirmation cap).
  const maxHighCents = audience === "painthome" ? policyFromSettings(policyRow).paintHomeCapCents : null;
  const c = copyFor(siteCopy, audience);
  const prefix = audiencePrefix(audience);
  // ⚑ D2: the wizard lives on the residential domain; from the commercial
  // domain the hand-off is absolute. Paint Home hosts the wizard under its
  // own domain (Paint Home brief §5, ⚑ P5), so its hand-off is relative.
  const wizardOrigin = audience === "business" && commercialDomain() ? (residentialOrigin() ?? "") : "";
  const business = audience === "business";
  const painthome = audience === "painthome";
  const pageUrl = painthome ? `${brand.url}/` : business && commercialDomain() ? `https://${commercialDomain()}/` : "https://paintgroup.com.au/";
  const ld = localBusinessLd(brand, c.meta.serviceType, pageUrl);
  // `--brand-primary` is the one token Settings → Brands drives; the rest of
  // Paint Home's palette is the `[data-brand="painthome"]` block in marketing.css.
  const brandStyle = { "--brand-primary": brand.primaryColour } as CSSProperties;
  return (
    <AudienceProvider audience={audience} wizardOrigin={wizardOrigin} brand={brandView(brand)}>
      <div className="shopfront" data-brand={brand.key} style={brandStyle}>
        <Nav logoUrl={logoUrl} copy={c.nav} brand={brand} />
        <main data-audience={audience}>
          <Hero heroPhoto={painthome ? (content.heroPhotoPaintHome ?? content.heroPhoto) : business ? (content.heroPhotoBusiness ?? content.heroPhoto) : content.heroPhoto} copy={c.hero} />
          <HowItWorks copy={c.steps} brand={brand} />
          <RealJobs audience={audience} copy={c.jobs} prefix={prefix} maxHighCents={maxHighCents} />
          {business && <Trade copy={c.trade} promoted />}
          <PromiseSection variationPhotos={content.promisePhotos} copy={c.promise} />
          <Story photos={content.storyPhotos} copy={c.story} />
          <LiveStrip heading={c.live} />
          <Painters painters={content.painters} copy={c.painters} brand={brand} />
          {audience === "home" && <Trade copy={c.trade} />}
          <Reviews featuredVideoJobId={content.featuredVideoJobId} featuredVideo={content.featuredVideo} audience={audience} copy={c.reviews} poweredBy={brand.poweredBy} />
          <Faq h2={c.faq.h2} entries={c.faq.entries} />
          <ClosingCta copy={c.cta} />
        </main>
        <Footer brand={brand} prefix={prefix} />
        <CallBar />
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(c.faq.entries)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </AudienceProvider>
  );
}
