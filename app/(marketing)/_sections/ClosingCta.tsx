"use client";

import { useRouter } from "next/navigation";
import AddressField, { type FieldLabels } from "../_components/AddressField";
import TelLink from "../_components/TelLink";
import { useAudience } from "../_components/Audience";
import { track } from "@/lib/analytics";
import { entrySourceFor } from "@/lib/marketing/audience";
import { estimateHref, type Mode } from "@/lib/marketing/estimateLink";
import { PHONE_DISPLAY } from "@/lib/marketing/site";

export type CtaCopy = { h2: string; callLine: string; labels: FieldLabels };

/** §4.13 — cyan section, the second AddressField (ink), `see_price` with where: bottom. Session 8: chips, defaulting to the site's audience. */
export default function ClosingCta({ copy }: { copy: CtaCopy }) {
  const router = useRouter();
  const { audience, wizardOrigin } = useAudience();
  function submit(address: string, mode: Mode) {
    track("see_price", { where: "bottom", mode, address });
    router.push(estimateHref(address, mode, { src: entrySourceFor(audience, "bottom"), origin: wizardOrigin }));
  }
  return (
    <section className="sec cta" id="cta">
      <div className="wrap">
        <h2>{copy.h2}</h2>
        <div className="cta-field"><AddressField where="bottom" showChips={audience === "business"} labels={copy.labels} onSubmit={submit} /></div>
        <p>or call <TelLink where="bottom" className="tel">{PHONE_DISPLAY}</TelLink>. {copy.callLine}</p>
      </div>
    </section>
  );
}
