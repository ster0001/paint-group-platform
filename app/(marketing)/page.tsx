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
import { faqJsonLd } from "@/lib/marketing/faq";
import { getSiteLogo, getWebsiteContent } from "@/lib/marketing/siteContent";

/**
 * The marketing homepage (docs/briefs/homepage-v2-build-brief.md). One job:
 * get a visitor to type their address. The thirteen sections in §3's order,
 * one file each under _sections/ (no section imports another). Static with
 * ISR: the data is the three featured showcase jobs plus Settings → Website
 * (painters, photos, logo); both save actions revalidate "/".
 */
export const revalidate = 60;

export default async function HomePage() {
  const [content, logoUrl] = await Promise.all([getWebsiteContent(), getSiteLogo()]);
  return (
    <>
      <Nav logoUrl={logoUrl} />
      <main>
        <Hero heroPhoto={content.heroPhoto} />
        <HowItWorks />
        <RealJobs />
        <PromiseSection variationPhotos={content.promisePhotos} />
        <Story photos={content.storyPhotos} />
        <LiveStrip />
        <Painters painters={content.painters} />
        <Trade />
        <Reviews featuredVideoJobId={content.featuredVideoJobId} />
        <Faq />
        <ClosingCta />
      </main>
      <Footer />
      <CallBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }} />
    </>
  );
}
