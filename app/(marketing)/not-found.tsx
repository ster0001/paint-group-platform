import Link from "next/link";
import { getSiteLogo } from "@/lib/marketing/siteContent";
import { getAudience } from "@/lib/marketing/audienceServer";
import { audiencePrefix } from "@/lib/marketing/audience";
import { brandView } from "@/lib/marketing/brand";
import { getBrand } from "@/lib/marketing/brandServer";
import { AudienceProvider } from "./_components/Audience";
import Nav from "./_sections/Nav";
import Footer from "./_sections/Footer";
import CallBar from "./_sections/CallBar";

/**
 * The marketing 404 — an unpublished or unknown /work slug lands here. It
 * reads the request's audience so a Paint Home visitor who mistypes a URL
 * sees Paint Home's nav and footer, never Paint Group's (Paint Home brief
 * §1a: Paint Home stands on its own).
 */
export default async function MarketingNotFound() {
  const audience = await getAudience();
  const [logoUrl, brand] = await Promise.all([getSiteLogo(), getBrand(audience)]);
  const prefix = audiencePrefix(audience);
  return (
    <AudienceProvider audience={audience} brand={brandView(brand)}>
      <div className="shopfront" data-brand={brand.key}>
        <Nav logoUrl={logoUrl} brand={brand} copy={{ links: [{ label: "Real jobs, real prices", href: "/work" }, { label: "How it works", href: "/#how" }, { label: "Reviews", href: "/#reviews" }], otherLabel: "", otherHref: "", cta: "See my price", prefix }} />
        <main className="sec light" style={{ minHeight: "60svh" }}>
          <div className="wrap">
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>404</div>
            <h1 className="work-h1">That page isn&rsquo;t here.</h1>
            <p className="lead" style={{ marginTop: 14 }}>The job may have been taken down, or the address is wrong.</p>
            <p style={{ marginTop: 24 }}><Link href={`${prefix}/work`} className="btn btn-ink">See all jobs →</Link></p>
          </div>
        </main>
        <Footer brand={brand} prefix={prefix} />
        <CallBar />
      </div>
    </AudienceProvider>
  );
}
