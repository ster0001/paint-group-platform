import Image from "next/image";
import Link from "next/link";
import TelLink from "../_components/TelLink";
import TrackedLink from "../_components/TrackedLink";
import { PHONE_DISPLAY } from "@/lib/marketing/site";

/** §4.1 — sticky translucent ink; four links ≥960px; the phone number is
 *  in the nav on desktop and in the call bar on mobile, so it never hides.
 *  The logo is Settings → Company details → logo 1 (light-on-dark); the
 *  wordmark stands in when none is set. */
export type NavCopy = { links: Array<{ label: string; href: string }>; otherLabel: string; otherHref: string; cta: string; prefix: string };

export default function Nav({ logoUrl = "", copy }: { logoUrl?: string; copy?: NavCopy }) {
  const c: NavCopy = copy ?? {
    links: [{ label: "Real jobs, real prices", href: "/work" }, { label: "How it works", href: "#how" }, { label: "For business", href: "#trade" }, { label: "Reviews", href: "#reviews" }],
    otherLabel: "", otherHref: "", cta: "See my price", prefix: "",
  };
  // Internal paths carry the business site's local prefix (session 8 §2);
  // anchors and the cross-domain link are plain.
  const href = (h: string) => (h.startsWith("/") ? `${c.prefix}${h}` : h);
  return (
    <nav aria-label="Main">
      <Link href={c.prefix || "/"} className={logoUrl ? "brand" : "mono"} aria-label="Paint Group home">
        {logoUrl
          ? <Image src={logoUrl} alt="Paint Group" width={160} height={32} priority style={{ height: 28, width: "auto" }} />
          : "PAINT GROUP"}
      </Link>
      <div className="links">
        {c.links.map((l) => (l.href.startsWith("/")
          ? <Link key={l.label} href={href(l.href)}>{l.label}</Link>
          : <a key={l.label} href={l.href}>{l.label}</a>))}
        {c.otherLabel && c.otherHref && <a href={c.otherHref} className="other" data-testid="nav-other-audience">{c.otherLabel}</a>}
      </div>
      <div className="right">
        <TelLink where="nav" className="phone">{PHONE_DISPLAY}</TelLink>
        <TrackedLink href="#top" ev="nav_cta" evProps={{ where: "nav" }} className="btn btn-cyan">{c.cta}</TrackedLink>
      </div>
    </nav>
  );
}
