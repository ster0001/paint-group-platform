import Link from "next/link";

/**
 * The logo in the top-left corner of every staff surface that has its own
 * chrome (CRM, Projects, Payments), and the way back to the main platform
 * (Tom, 8 Sep: "there is still no button to go from the CRM back to the
 * main platform"). Tapping the logo goes home; the surface's own name sits
 * beside it so you still know where you are.
 *
 * `href` is the visitor's first visible area (Settings → Staff logins), so a
 * login that can't see Estimates is never sent to a screen that bounces it.
 */
export default function HomeMark({ href, logoUrl, suffix }: { href: string; logoUrl: string; suffix?: string }) {
  return (
    <Link href={href} className="homemark" title="Back to the main platform" aria-label="Back to the main platform" data-testid="home-mark">
      {logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={logoUrl} alt="Paint Group" className="homelogo" />
        : <span className="hometext">Paint<span className="homedot">·</span>Group</span>}
      {suffix && <span className="homesuffix">{suffix}</span>}
    </Link>
  );
}
