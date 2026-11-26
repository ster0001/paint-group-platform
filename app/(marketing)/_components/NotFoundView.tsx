import Link from "next/link";
import { getSiteLogo } from "@/lib/marketing/siteContent";
import { audiencePrefix, type Audience } from "@/lib/marketing/audience";
import { brandView } from "@/lib/marketing/brand";
import { getBrand } from "@/lib/marketing/brandServer";
import { AudienceProvider } from "./Audience";
import Nav from "../_sections/Nav";
import Footer from "../_sections/Footer";
import CallBar from "../_sections/CallBar";

/**
 * The website's 404, ONE view for both doors into it: an unknown /work slug
 * (app/(marketing)/not-found.tsx) and an address no route answers at all
 * (app/not-found.tsx, on a website host). It wears the request's brand —
 * nav, footer and words — so a Paint Home visitor who mistypes an address
 * never meets Paint Group (Paint Home brief §1a; SEO foundations 26 Nov
 * 2026: links to the home page and to /work).
 */
export default async function NotFoundView({ audience }: { audience: Audience }) {
  const [logoUrl, brand] = await Promise.all([getSiteLogo(), getBrand(audience)]);
  const prefix = audiencePrefix(audience);
  return (
    <AudienceProvider audience={audience} brand={brandView(brand)}>
      <div className="shopfront" data-brand={brand.key}>
        <Nav logoUrl={logoUrl} brand={brand} copy={{ links: [{ label: "Real jobs, real prices", href: "/work" }, { label: "How it works", href: "/#how" }, { label: "Reviews", href: "/#reviews" }], otherLabel: "", otherHref: "", cta: "See my price", prefix }} />
        <main className="sec light" style={{ minHeight: "60svh" }} data-testid="not-found">
          <div className="wrap">
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>404</div>
            <h1 className="work-h1">That page isn&rsquo;t here.</h1>
            <p className="lead" style={{ marginTop: 14 }}>The page may have moved or been taken down, or the address is mistyped.</p>
            <p style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href={prefix || "/"} className="btn btn-ink">{brand.name} home →</Link>
              <Link href={`${prefix}/work`} className="btn btn-ink">See real jobs and prices →</Link>
            </p>
          </div>
        </main>
        <Footer brand={brand} prefix={prefix} />
        <CallBar />
      </div>
    </AudienceProvider>
  );
}
