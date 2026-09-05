"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import AddressField from "../_components/AddressField";
import TelLink from "../_components/TelLink";
import { track } from "@/lib/analytics";
import { estimateHref, type Mode } from "@/lib/marketing/estimateLink";
import { PHONE_DISPLAY } from "@/lib/marketing/site";
import { showcaseMediaUrl } from "@/lib/showcase/format";

/**
 * §4.2 — dark, full-viewport, the taped-off copy block (border only).
 * Copy is the prototype's, verbatim. Submit fires `see_price` with
 * {where, mode} and routes to the wizard with both on the URL.
 * The self-typing estimator plays inside AddressField (`ghost`).
 */
export default function Hero({ heroPhoto = null }: { heroPhoto?: string | null }) {
  const router = useRouter();

  function submit(address: string, mode: Mode) {
    track("see_price", { where: "hero", mode, address });
    router.push(estimateHref(address, mode));
  }

  return (
    <section className="hero" id="top">
      {heroPhoto && (
        <div className="hero-photo" aria-hidden="true" data-testid="hero-photo">
          <Image src={showcaseMediaUrl(heroPhoto)} alt="" fill priority sizes="100vw" style={{ objectFit: "cover" }} />
        </div>
      )}
      <div className="stage">
        <div className="block">
          <div className="mono" style={{ color: "var(--color-muted)" }}>
            Melbourne · homes and businesses · see your price today · confirmed by a person before we start
          </div>
          <h1>Transforming spaces.<br />Redefining painting.</h1>
          <p className="lead">
            Type the address. A home, a shop, an office or a whole portfolio. See a real price range in about ten
            minutes.
          </p>
          <AddressField where="hero" showChips ghost onSubmit={submit} />
          <div className="under">
            <span>
              Rather talk to a person? <strong><TelLink where="hero">Call {PHONE_DISPLAY}</TelLink></strong>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
