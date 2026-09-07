import Link from "next/link";
import type { CompanyLogos } from "@/lib/company/logo";

/**
 * The logo in the top-left corner of every staff surface that has its own
 * chrome (CRM, Projects, Payments), and the way back to the main platform
 * (Tom, 8 Sep: "there is still no button to go from the CRM back to the
 * main platform"). Tapping the logo goes home; the surface's own name sits
 * beside it so you still know where you are.
 *
 * Two logos ride along (Tom, 8 Sep): the dark-lettering one for light mode
 * and the white-lettering one for dark mode. Both are in the page and the
 * surface's `[data-theme]` decides which shows, so the theme button swaps
 * them instantly with no round trip.
 *
 * `href` is the visitor's first visible area (Settings → Staff logins), so a
 * login that can't see Estimates is never sent to a screen that bounces it.
 */
export default function HomeMark({ href, logos, suffix }: { href: string; logos: CompanyLogos; suffix?: string }) {
  return (
    <Link href={href} className="homemark" title="Back to the main platform" aria-label="Back to the main platform" data-testid="home-mark">
      {logos.onDark || logos.onLight
        ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logos.onDark || logos.onLight} alt="Paint Group" className="homelogo homelogo-dark" data-testid="home-logo-dark" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logos.onLight || logos.onDark} alt="Paint Group" className="homelogo homelogo-light" data-testid="home-logo-light" />
          </>
        : <span className="hometext">Paint<span className="homedot">·</span>Group</span>}
      {suffix && <span className="homesuffix">{suffix}</span>}
    </Link>
  );
}
