import PaintHomeLogo from "@/app/(marketing)/_components/PaintHomeLogo";
import type { WizardBrand } from "@/lib/wizard/brand";

/** The wizard header's identity: the company logo from Settings when one is
 * set, otherwise the monospace wordmark it always had. On Paint Home (brief
 * §5) it is the Paint Home mark, inline, so the customer never sees Paint
 * Group mid-flow. Server and client safe.
 *
 * `on` is the background the mark sits on, and the CALLER hands over the
 * matching file: `on="light"` (the default — the desktop header, the light
 * pages) takes the light-background logo; `on="dark"` (the phone and quote
 * stage header, Tom 20 Nov 2026 — "on a dark background like our website")
 * takes the website's own mark, `company_profile.logoUrl`. With no file for
 * a dark bar it draws the wordmark in light type — never a dark-type logo on
 * a dark bar. */
export default function Wordmark({ logoUrl, brand = "paintgroup", on = "light" }: { logoUrl?: string | null; brand?: WizardBrand; on?: "light" | "dark" }) {
  if (brand === "painthome") return <PaintHomeLogo variant="nav" on={on} className="wz-logo" title="Paint Home" />;
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="wz-logo" src={logoUrl} alt="Paint Group" data-on={on} />
    : <div className={on === "dark" ? "wz-wm wz-wm--dark" : "wz-wm"} data-on={on}>PAINT<span>—</span>GROUP</div>;
}
