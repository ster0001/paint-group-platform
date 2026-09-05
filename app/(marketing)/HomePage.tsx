import type { Metadata } from "next";
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
import { PHONE_DISPLAY } from "@/lib/marketing/site";
import type { GhostExample } from "@/lib/marketing/ghostEstimator";

/**
 * Session 8 — ONE homepage, two audiences. `app/(marketing)/page.tsx`
 * renders it for homes and `app/(marketing)/business/page.tsx` for
 * businesses (the commercial domain's root is rewritten there by the
 * proxy), so both stay static with ISR. Every string comes from
 * site_content (lib/marketing/siteCopy) or the showcase table or Google;
 * the section ORDER is the one thing decided here: the trade lane is
 * promoted to sit straight after the jobs on the business site (§4).
 */
// Both routes declare `export const revalidate = 60` themselves (Next needs a literal there).

const LOCAL_BUSINESS_ID = "https://paintgroup.com.au/#business";

function copyFor(c: SiteCopy, audience: Audience) {
  const t = (s: Parameters<typeof text>[1], k: string) => text(c, s, k);
  const examples: GhostExample[] = [1, 2, 3]
    .map((n) => ({ address: t("estimator_examples", `example_${n}_address`), price: t("estimator_examples", `example_${n}_price`), time: t("estimator_examples", `example_${n}_time`), mode: audience }))
    .filter((e) => e.address && e.price);
  const labels = { placeholder: t("hero", "placeholder"), button: t("hero", "button"), chipsLabel: t("hero", "chips_label"), chipHome: t("hero", "chip_home"), chipBusiness: t("hero", "chip_business") };
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
    reviews: { h2: t("reviews", "h2"), fallbackH2: t("reviews", "fallback_h2") },
    faq: { h2: t("faq", "h2"), entries: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ q: t("faq", `q_${n}`), a: t("faq", `a_${n}`) })).filter((e) => e.q) as FaqEntry[] },
    cta: { h2: t("cta", "h2"), callLine: t("cta", "call_line"), labels },
    nav: {
      links: [1, 2, 3, 4].map((n) => ({ label: t("nav", `link_${n}_label`), href: t("nav", `link_${n}_href`) })).filter((l) => l.label && l.href),
      otherLabel: t("nav", "other_audience_label"), otherHref: otherAudienceHref(audience), cta: t("nav", "cta"), prefix: audiencePrefix(audience),
    },
    meta: { title: t("meta", "title_tag"), description: t("meta", "meta_description"), serviceType: t("meta", "service_type") },
  };
}

export async function homeMetadata(audience: Audience): Promise<Metadata> {
  const c = copyFor(await getSiteCopy(audience), audience);
  return {
    title: c.meta.title,
    description: c.meta.description,
    // §7: canonicals are self-referential per domain; the proxy keeps each URL on one domain.
    alternates: { canonical: audience === "business" && commercialDomain() ? `https://${commercialDomain()}/` : audiencePrefix(audience) || "/" },
  };
}

export default async function HomePage({ audience }: { audience: Audience }) {
  const [content, logoUrl, siteCopy] = await Promise.all([getWebsiteContent(), getSiteLogo(), getSiteCopy(audience)]);
  const c = copyFor(siteCopy, audience);
  const prefix = audiencePrefix(audience);
  // ⚑ D2: the wizard lives on the residential domain; from the commercial
  // domain the hand-off is absolute.
  const wizardOrigin = audience === "business" && commercialDomain() ? (residentialOrigin() ?? "") : "";
  const business = audience === "business";
  const localBusinessLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": LOCAL_BUSINESS_ID,
    name: "Paint Group",
    telephone: PHONE_DISPLAY,
    areaServed: "Melbourne, Victoria",
    address: { "@type": "PostalAddress", addressLocality: "Melbourne", addressRegion: "VIC", addressCountry: "AU" },
    serviceType: c.meta.serviceType,
    url: business && commercialDomain() ? `https://${commercialDomain()}/` : "https://paintgroup.com.au/",
  };
  return (
    <AudienceProvider audience={audience} wizardOrigin={wizardOrigin}>
      <Nav logoUrl={logoUrl} copy={c.nav} />
      <main data-audience={audience}>
        <Hero heroPhoto={content.heroPhoto} copy={c.hero} />
        <HowItWorks copy={c.steps} />
        <RealJobs audience={audience} copy={c.jobs} prefix={prefix} />
        {business && <Trade copy={c.trade} promoted />}
        <PromiseSection variationPhotos={content.promisePhotos} copy={c.promise} />
        <Story photos={content.storyPhotos} copy={c.story} />
        <LiveStrip heading={c.live} />
        <Painters painters={content.painters} copy={c.painters} />
        {!business && <Trade copy={c.trade} />}
        <Reviews featuredVideoJobId={content.featuredVideoJobId} featuredVideo={content.featuredVideo} audience={audience} copy={c.reviews} />
        <Faq h2={c.faq.h2} entries={c.faq.entries} />
        <ClosingCta copy={c.cta} />
      </main>
      <Footer />
      <CallBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(c.faq.entries)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessLd) }} />
    </AudienceProvider>
  );
}
