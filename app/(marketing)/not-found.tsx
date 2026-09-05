import Link from "next/link";
import { getSiteLogo } from "@/lib/marketing/siteContent";
import Nav from "./_sections/Nav";
import Footer from "./_sections/Footer";
import CallBar from "./_sections/CallBar";

/** The marketing 404 — an unpublished or unknown /work slug lands here. */
export default async function MarketingNotFound() {
  const logoUrl = await getSiteLogo();
  return (
    <>
      <Nav logoUrl={logoUrl} />
      <main className="sec light" style={{ minHeight: "60svh" }}>
        <div className="wrap">
          <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>404</div>
          <h1 className="work-h1">That page isn&rsquo;t here.</h1>
          <p className="lead" style={{ marginTop: 14 }}>The job may have been taken down, or the address is wrong.</p>
          <p style={{ marginTop: 24 }}><Link href="/work" className="btn btn-ink">See all jobs →</Link></p>
        </div>
      </main>
      <Footer />
      <CallBar />
    </>
  );
}
