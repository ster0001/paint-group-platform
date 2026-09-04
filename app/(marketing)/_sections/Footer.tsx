import Link from "next/link";
import CookieSettingsLink from "../_components/CookieSettingsLink";

/**
 * §4.14 — as the prototype. Service and legal pages are not in this brief
 * (⚑9.8 covers the suburb/service pages); those links stay `#` with a
 * data-todo so nothing is silently filled. "Cookie settings" reopens the
 * consent sheet.
 */
export default function Footer() {
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
        <Link href="/work">Real jobs, real prices</Link>
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
