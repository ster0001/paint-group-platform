import Link from "next/link";
import CookieSettingsLink from "../_components/CookieSettingsLink";
import PaintHomeLogo from "../_components/PaintHomeLogo";
import { BRAND_DEFAULTS, type Brand } from "@/lib/marketing/brand";
import { estimateHref } from "@/lib/marketing/estimateLink";

/**
 * §4.14 — as the prototype. Service and legal pages are not in this brief
 * (⚑9.8 covers the suburb/service pages); those links stay `#` with a
 * data-todo so nothing is silently filled. "Cookie settings" reopens the
 * consent sheet.
 *
 * Paint Home (brief §4, footer row): its own block — the full mark, the
 * tagline, the one "Powered by Paint Group" credit and the Enlvn legal line;
 * Services: Apartments & units · Interiors · Exteriors · Bigger jobs (⚑ P11:
 * the wizard, which hands a big job on itself). No Paint Group column, no
 * "For business", no link to paintgroup.com.au.
 */
export default function Footer({ brand = BRAND_DEFAULTS.paintgroup, prefix = "" }: { brand?: Brand; prefix?: string }) {
  if (brand.key === "painthome") {
    return (
      <footer data-testid="footer-painthome">
        <div>
          <PaintHomeLogo variant="full" on="dark" className="logo-full" title={brand.name} />
          {brand.tagline}<br />
          Melbourne, within 50 km<br /><br />
          <span className="pb" data-testid="footer-powered-by">Powered by {brand.poweredBy}</span><br />
          <span data-testid="footer-legal">{brand.legalLine}</span><br />
          Dulux · Haymes · Master Painters · NICA
        </div>
        <div>
          <b>Services</b>
          <a href="#" data-todo="9.8">Apartments &amp; units</a>
          <a href="#" data-todo="9.8">Interiors</a>
          <a href="#" data-todo="9.8">Exteriors</a>
          <Link href={estimateHref("", "home", { src: "painthome_home_footer", brand: "painthome" })} data-testid="footer-bigger-jobs">Bigger jobs</Link>
        </div>
        <div>
          <b>Company</b>
          <Link href={`${prefix}/work`}>Real jobs, real prices</Link>
          <a href="#reviews">Reviews</a>
          <a href="#faq">Questions</a>
          <a href="#" data-todo="9.8">Contact</a>
        </div>
        <div>
          <b>Legal</b>
          <a href="#" data-todo="9.8">Privacy</a>
          <a href="#" data-todo="9.8">Terms</a>
          <a href="#" data-todo="9.8">Warranty</a>
          <CookieSettingsLink />
        </div>
      </footer>
    );
  }
  return (
    <footer>
      <div>
        <b>PAINT GROUP</b>
        Painting · Plastering · Restoration<br />
        Melbourne, within 50 km<br /><br />
        Dulux · Haymes · Master Painters · NICA
      </div>
      <div>
        <b>SERVICES</b>
        <a href="#" data-todo="9.8">Interior</a>
        <a href="#" data-todo="9.8">Exterior</a>
        <a href="#" data-todo="9.8">Commercial</a>
        <a href="#" data-todo="9.8">Heritage</a>
        <a href="#" data-todo="9.8">Body corporate</a>
      </div>
      <div>
        <b>COMPANY</b>
        <Link href={`${prefix}/work`}>Real jobs, real prices</Link>
        <a href="#reviews">Reviews</a>
        <a href="#trade">For business</a>
        <a href="#" data-todo="9.8">Contact</a>
      </div>
      <div>
        <b>LEGAL</b>
        <a href="#" data-todo="9.8">Privacy</a>
        <a href="#" data-todo="9.8">Terms</a>
        <a href="#" data-todo="9.8">Warranty</a>
        <CookieSettingsLink />
      </div>
    </footer>
  );
}
