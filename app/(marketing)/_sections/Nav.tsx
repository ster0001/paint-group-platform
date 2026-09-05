import Image from "next/image";
import Link from "next/link";
import TelLink from "../_components/TelLink";
import TrackedLink from "../_components/TrackedLink";
import { PHONE_DISPLAY } from "@/lib/marketing/site";

/** §4.1 — sticky translucent ink; four links ≥960px; the phone number is
 *  in the nav on desktop and in the call bar on mobile, so it never hides.
 *  The logo is Settings → Company details → logo 1 (light-on-dark); the
 *  wordmark stands in when none is set. */
export default function Nav({ logoUrl = "" }: { logoUrl?: string }) {
  return (
    <nav aria-label="Main">
      <Link href="/" className={logoUrl ? "brand" : "mono"} aria-label="Paint Group home">
        {logoUrl
          ? <Image src={logoUrl} alt="Paint Group" width={160} height={32} priority style={{ height: 28, width: "auto" }} />
          : "PAINT GROUP"}
      </Link>
      <div className="links">
        <Link href="/work">Real jobs, real prices</Link>
        <a href="#how">How it works</a>
        <a href="#trade">For business</a>
        <a href="#reviews">Reviews</a>
      </div>
      <div className="right">
        <TelLink where="nav" className="phone">{PHONE_DISPLAY}</TelLink>
        <TrackedLink href="#top" ev="nav_cta" evProps={{ where: "nav" }} className="btn btn-cyan">See my price</TrackedLink>
      </div>
    </nav>
  );
}
