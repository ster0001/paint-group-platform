import PaintHomeLogo from "@/app/(marketing)/_components/PaintHomeLogo";
import type { WizardBrand } from "@/lib/wizard/brand";

/** The wizard family's header identity. Every header it sits in is a DARK bar
 * like the website's nav (Tom, 20 Nov 2026 — "on a dark background like our
 * website … neater and bigger"), so the caller hands over the website's own
 * mark, `company_profile.logoUrl` (the dark-background logo) — never
 * `logoUrlLight`, whose dark type would vanish on the bar. With no file it is
 * the lettered wordmark in light type. On Paint Home (brief §5) it is the
 * Paint Home mark, inline, with its light text fill, so the customer never
 * sees Paint Group mid-flow. Server and client safe. */
export default function Wordmark({ logoUrl, brand = "paintgroup" }: { logoUrl?: string | null; brand?: WizardBrand }) {
  if (brand === "painthome") return <PaintHomeLogo variant="nav" on="dark" className="wz-logo" title="Paint Home" />;
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="wz-logo" src={logoUrl} alt="Paint Group" data-on="dark" />
    : <div className="wz-wm" data-on="dark">PAINT<span>—</span>GROUP</div>;
}
