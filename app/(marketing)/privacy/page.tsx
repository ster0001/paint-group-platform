import type { Metadata } from "next";
import LegalPage, { legalContext } from "../_components/LegalPage";
import { PRIVACY_VERSION, privacySections } from "@/lib/marketing/legal";

/** /privacy — the brand's privacy policy (lib/marketing/legal.ts). Reads the host, so it renders per request. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await legalContext();
  return { title: `Privacy policy | ${brand.name}`, description: `How ${brand.name} collects, uses and protects your personal information.`, robots: { index: true, follow: true } };
}

// PRIVACY_VERSION is a calendar date, not a moment: read it at UTC midday in UTC, so no zone offset is written down.
const UPDATED = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${PRIVACY_VERSION}T12:00:00Z`));

export default async function PrivacyPage() {
  const ctx = await legalContext();
  return (
    <LegalPage title="Privacy policy" updated={UPDATED} ctx={ctx}>
      {privacySections(ctx.party).map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.paragraphs.slice(0, 1).map((p) => <p key={p}>{p}</p>)}
          {s.bullets && <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          {s.paragraphs.slice(1).map((p) => <p key={p}>{p}</p>)}
        </section>
      ))}
    </LegalPage>
  );
}
