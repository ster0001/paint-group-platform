"use client";

import { useRouter } from "next/navigation";
import AddressField from "./AddressField";
import { track } from "@/lib/analytics";
import { estimateHref, type Mode } from "@/lib/marketing/estimateLink";
import type { ShowcaseJob } from "@/lib/showcase/schema";
import { useAudience } from "./Audience";

/**
 * §4.4c block 8 — "A job like this in your home or business?" The address
 * field with the mode pre-set from the job's property type; submit fires
 * `job_get_price` with the slug and opens the wizard with scope from the
 * job type (session 4 wires the wizard side; the URL carries it now).
 * In the editor preview nothing navigates.
 */
export default function GetPriceLike({ job, preview = false }: { job: ShowcaseJob; preview?: boolean }) {
  const router = useRouter();
  // Paint Home (brief §5): residential only, the hand-off tagged with the brand.
  const painthome = useAudience().audience === "painthome";
  function submit(address: string, mode: Mode) {
    if (preview) return;
    track("job_get_price", { slug: job.slug, mode });
    router.push(estimateHref(address, mode, { scope: job.job_type, from: job.slug, src: `job_page:${job.slug}`, carry: window.location.search, brand: painthome ? "painthome" : undefined }));
  }
  return (
    <section className="pp-cta" aria-labelledby="pp-cta-h">
      <div className="wrap">
        <h2 id="pp-cta-h">A job like this in your home or business?</h2>
        <p className="lead">Type the address and see your own range in about ten minutes, the same scope as this job, priced for your place.</p>
        <div className="pp-cta-field">
          <AddressField where="project" showChips={!painthome} initialMode={painthome ? "home" : job.property_type} onSubmit={submit} />
        </div>
      </div>
    </section>
  );
}
