import type { Metadata } from "next";
import { getSiteLogo } from "@/lib/marketing/siteContent";
import Nav from "../_sections/Nav";
import Footer from "../_sections/Footer";
import CallBar from "../_sections/CallBar";
import WorkList from "./WorkList";
import { publishedShowcaseJobs } from "@/lib/showcase/queries";

/**
 * /work — every published showcase job as a JobCard, newest completed
 * first, with job-type and property-type filter chips (brief §4.4c).
 * Static with ISR: the save action revalidates this path, so a publish or
 * unpublish shows within a minute.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Real jobs, real prices | Paint Group",
  description: "Finished painting jobs across Melbourne with the real price of each one, inc. GST.",
};

export default async function WorkPage() {
  const [jobs, logoUrl] = await Promise.all([publishedShowcaseJobs(), getSiteLogo()]);
  return (
    <>
      <Nav logoUrl={logoUrl} />
      <main className="sec light" id="jobs">
        <div className="wrap">
          <div className="head">
            <div>
              <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>Real jobs · real prices · inc. GST</div>
              <h1 className="work-h1">What Melbourne properties actually cost to paint.</h1>
              <p className="lead" style={{ marginTop: 14 }}>
                Every card is a finished job with the real price. Open one to see what was done, the photos, and to get a price like it for your place.
              </p>
            </div>
          </div>
          <WorkList jobs={jobs} />
        </div>
      </main>
      <Footer />
      <CallBar />
    </>
  );
}
