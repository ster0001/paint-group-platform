import Nav from "./_sections/Nav";
import Hero from "./_sections/Hero";
import Footer from "./_sections/Footer";
import CallBar from "./_sections/CallBar";

/**
 * The marketing homepage (docs/briefs/homepage-v2-build-brief.md). One job:
 * get a visitor to type their address. Section order is §3; this is the
 * session-1 walking skeleton — nav, hero with the static address field,
 * footer, mobile call bar. Sections 3–12 land in sessions 5–6, each its own
 * file under _sections/ (no section imports another).
 */
export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
      </main>
      <Footer />
      <CallBar />
    </>
  );
}
