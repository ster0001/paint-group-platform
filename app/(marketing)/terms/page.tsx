import type { Metadata } from "next";
import LegalPage, { legalContext } from "../_components/LegalPage";
import { pageSeo } from "@/lib/marketing/seo";
import { getSettingValue } from "@/lib/marketing/brandServer";
import { termsForBrand } from "@/lib/marketing/legal";

/**
 * /terms — the terms every estimate shows below its accept panel (Settings →
 * Terms & conditions, key `terms_conditions`), with the brand's trading
 * name. One source: edit them in Settings and this page follows.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { brand, audience } = await legalContext();
  return { title: `Terms and conditions | ${brand.name}`, description: `The terms that apply when ${brand.name} quotes for and carries out your painting.`, robots: { index: true, follow: true }, ...pageSeo(audience, brand, "/terms") };
}

export default async function TermsPage() {
  const ctx = await legalContext();
  const raw = await getSettingValue("terms_conditions");
  const paragraphs = termsForBrand(typeof raw === "string" ? raw : "", ctx.brand);
  return (
    <LegalPage title="Terms and conditions" ctx={ctx}>
      <p>These are the terms that apply to work carried out by {ctx.party.legalLine}. The same terms are shown on your estimate before you accept it.</p>
      {paragraphs.length > 0
        ? paragraphs.map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)
        : <p data-testid="terms-empty">Our full terms are provided with your estimate, before you accept it. To see them sooner, call {ctx.party.phone} or email {ctx.party.email}.</p>}
    </LegalPage>
  );
}
