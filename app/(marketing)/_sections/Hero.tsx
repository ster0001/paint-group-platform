"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import AddressField, { type FieldLabels } from "../_components/AddressField";
import type { PickedAddress } from "@/app/components/useAddressLookup";
import Md from "../_components/Md";
import { useAudience } from "../_components/Audience";
import { entrySourceFor } from "@/lib/marketing/audience";
import type { GhostExample } from "@/lib/marketing/ghostEstimator";
import TelLink from "../_components/TelLink";
import { track } from "@/lib/analytics";
import { estimateHref, type Mode, type Scope } from "@/lib/marketing/estimateLink";
import { showcaseMediaUrl } from "@/lib/showcase/format";

/**
 * §4.2 — dark, full-viewport, the taped-off copy block (border only).
 * Copy is the prototype's, verbatim. Submit fires `see_price` with
 * {where, mode} and routes to the wizard with both on the URL.
 * The self-typing estimator plays inside AddressField (`ghost`).
 *
 * Paint Home (brief §4–5): the chips are Inside / Outside (a scope, not a
 * mode — residential only) and the hand-off carries `brand=painthome` and
 * `scope=interior|exterior`.
 */
export type HeroCopy = { kicker: string; h1Lines: string[]; lead: string; talkLine: string; labels: FieldLabels; examples: GhostExample[] };

export default function Hero({ heroPhoto = null, copy }: { heroPhoto?: string | null; copy: HeroCopy }) {
  const router = useRouter();
  const { audience, wizardOrigin, brand } = useAudience();
  const painthome = audience === "painthome";

  function submit(address: string, mode: Mode, scope: Scope, picked: PickedAddress | null) {
    track("see_price", { where: "hero", mode, address, ...(painthome ? { scope } : {}) });
    router.push(estimateHref(address, mode, { src: entrySourceFor(audience, "hero"), origin: wizardOrigin, carry: window.location.search, brand: painthome ? "painthome" : undefined, scope: painthome ? scope : undefined, picked }));
  }

  return (
    <section className="hero" id="top">
      {heroPhoto && (
        <div className="hero-photo" aria-hidden="true" data-testid="hero-photo">
          <Image src={showcaseMediaUrl(heroPhoto)} alt="" fill priority sizes="100vw" style={{ objectFit: "cover", objectPosition: "center 40%" }} />
        </div>
      )}
      <div className="stage">
        <div className="block">
          <div className="mono" style={{ color: "var(--color-muted)" }}>{copy.kicker}</div>
          <h1>{copy.h1Lines.map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}</h1>
          <p className="lead"><Md src={copy.lead} inline /></p>
          <AddressField where="hero" showChips chips={painthome ? "scope" : "mode"} ghost examples={copy.examples} labels={copy.labels} onSubmit={submit} />
          <div className="under">
            <span>
              {copy.talkLine} <strong><TelLink where="hero">Call {brand.phoneDisplay}</TelLink></strong>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
