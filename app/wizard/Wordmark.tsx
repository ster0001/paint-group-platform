import PaintHomeLogo from "@/app/(marketing)/_components/PaintHomeLogo";
import type { WizardBrand } from "@/lib/wizard/brand";

/** The wizard header's top-left identity: the company logo from Settings
 * (the light-background one since 5 Oct 2026 — the wizard is light; the
 * caller falls back to logo 1) when one is set, otherwise the monospace
 * wordmark it always had. On Paint Home (brief §5) it is the Paint Home mark,
 * inline, so the customer never sees Paint Group mid-flow. Server and client safe. */
export default function Wordmark({ logoUrl, brand = "paintgroup" }: { logoUrl?: string | null; brand?: WizardBrand }) {
  if (brand === "painthome") return <PaintHomeLogo variant="nav" on="light" className="wz-logo" title="Paint Home" />;
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="wz-logo" src={logoUrl} alt="Paint Group" />
    : <div className="wz-wm">PAINT<span>—</span>GROUP</div>;
}
