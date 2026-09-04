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

/**
 * The marketing homepage (docs/briefs/homepage-v2-build-brief.md). One job:
 * get a visitor to type their address. The thirteen sections in §3's order,
 * one file each under _sections/ (no section imports another). Static with
 * ISR: the only data is the three featured showcase jobs, and the save
 * action revalidates "/" when they change.
 */
export const revalidate = 60;

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <RealJobs />
        <PromiseSection />
        <Story />
        <LiveStrip />
        <Painters />
        <Trade />
        <Reviews />
        <Faq />
        <ClosingCta />
      </main>
      <Footer />
      <CallBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }} />
    </>
  );
}
