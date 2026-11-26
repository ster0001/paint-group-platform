import { getSiteLogo } from "@/lib/marketing/siteContent";
import { getAudience } from "@/lib/marketing/audienceServer";
import { audiencePrefix } from "@/lib/marketing/audience";
import { brandView, type Brand } from "@/lib/marketing/brand";
import { getBrand, getSettingValue } from "@/lib/marketing/brandServer";
import { legalPartyFor, type LegalParty } from "@/lib/marketing/legal";
import { AudienceProvider } from "./Audience";
import Nav from "../_sections/Nav";
import Footer from "../_sections/Footer";
import CallBar from "../_sections/CallBar";

/**
 * The shell of /privacy, /terms and /warranty (go-live check, 25 Nov 2026):
 * the request's brand on the nav and footer, one readable column between.
 * The page hands its body a `party` — the brand's name and contact details
 * over the one company's ABN and address (Settings → Company details).
 */
export async function legalContext(): Promise<{ brand: Brand; party: LegalParty; prefix: string; logoUrl: string; audience: Awaited<ReturnType<typeof getAudience>> }> {
  const audience = await getAudience();
  const [logoUrl, brand, company] = await Promise.all([getSiteLogo(), getBrand(audience), getSettingValue("company_profile")]);
  const party = legalPartyFor(brand, (company ?? {}) as { abn?: string; addressLine1?: string; addressLine2?: string });
  return { brand, party, prefix: audiencePrefix(audience), logoUrl, audience };
}

export default async function LegalPage({ title, updated, children, ctx }: { title: string; updated?: string; children: React.ReactNode; ctx: Awaited<ReturnType<typeof legalContext>> }) {
  const { brand, prefix, logoUrl, audience } = ctx;
  return (
    <AudienceProvider audience={audience} brand={brandView(brand)}>
      <div className="shopfront" data-brand={brand.key}>
        <Nav logoUrl={logoUrl} brand={brand} copy={{ links: [{ label: "Real jobs, real prices", href: "/work" }, { label: "How it works", href: "/#how" }, { label: "Reviews", href: "/#reviews" }], otherLabel: "", otherHref: "", cta: "See my price", prefix }} />
        <main className="sec light legal" data-testid="legal-page">
          <div className="wrap">
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>{brand.name}{updated ? ` \u00b7 updated ${updated}` : ""}</div>
            <h1 className="work-h1">{title}</h1>
            <div className="legal-body">{children}</div>
          </div>
        </main>
        <Footer brand={brand} prefix={prefix} />
        <CallBar />
      </div>
    </AudienceProvider>
  );
}
