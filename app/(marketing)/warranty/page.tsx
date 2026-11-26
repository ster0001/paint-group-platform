import type { Metadata } from "next";
import LegalPage, { legalContext } from "../_components/LegalPage";
import { pageSeo } from "@/lib/marketing/seo";
import { ACL_LINE, WARRANTY_TERMS_VERSION, warrantyClauses, warrantyLimit, warrantyPromise } from "@/lib/warranty/terms";

/**
 * /warranty — the workmanship warranty, rendered FROM lib/warranty/terms.ts
 * (Tom approved those words on 19 Sep 2026; never retyped here). The party
 * is the brand's name and contact details over the one company's ABN.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { brand, audience } = await legalContext();
  return { title: `Workmanship warranty | ${brand.name}`, description: `The two-year workmanship warranty on every job ${brand.name} completes.`, robots: { index: true, follow: true }, ...pageSeo(audience, brand, "/warranty") };
}

export default async function WarrantyPage() {
  const ctx = await legalContext();
  const { party } = ctx;
  const clauses = warrantyClauses({ companyName: party.legalLine || party.tradingName, abn: party.abn || undefined, address: party.address || undefined, phone: party.phone, email: party.email });
  return (
    <LegalPage title="Workmanship warranty" updated={WARRANTY_TERMS_VERSION} ctx={ctx}>
      <p>{warrantyPromise()}</p>
      <p>{warrantyLimit()}</p>
      <p>{ACL_LINE}</p>
      {clauses.map((c) => (
        <section key={c.n}>
          <h2>{c.n}. {c.heading}</h2>
          <p>{c.body}</p>
        </section>
      ))}
    </LegalPage>
  );
}
