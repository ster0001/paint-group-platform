"use client";

import { useRouter } from "next/navigation";
import AddressField from "../_components/AddressField";
import TelLink from "../_components/TelLink";
import { track } from "@/lib/analytics";
import { estimateHref, type Mode } from "@/lib/marketing/estimateLink";
import { PHONE_DISPLAY } from "@/lib/marketing/site";

/** §4.13 — cyan section, the second AddressField (ink), `see_price` with where: bottom. */
export default function ClosingCta() {
  const router = useRouter();
  function submit(address: string, mode: Mode) {
    track("see_price", { where: "bottom", mode, address });
    router.push(estimateHref(address, mode, { src: "homepage_cta" }));
  }
  return (
    <section className="sec cta" id="cta">
      <div className="wrap">
        <h2>See what it costs to paint your home or business. Now.</h2>
        <div className="cta-field"><AddressField where="bottom" onSubmit={submit} /></div>
        <p>or call <TelLink where="bottom" className="tel">{PHONE_DISPLAY}</TelLink>. A real person, Mon to Fri, 8am to 5pm.</p>
      </div>
    </section>
  );
}
