import type { Metadata } from "next";
import HomePage, { homeMetadata } from "../HomePage";

/**
 * The Paint Home homepage (docs/briefs/paint-home.md §3–4). The proxy
 * serves painthome.com.au's root from this route (lib/marketing/audience.ts
 * resolveAudience); on a dev host it is simply /painthome (the Settings
 * preview, the C1 server), and anywhere else /painthome 301s to the
 * domain. Same HomePage, third audience: the brand changes the nav, the
 * footer, the metadata, the schema and the palette; the words are the home
 * set until Session 2 seeds Paint Home's own.
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata("painthome");
}

export default function Page() {
  return <HomePage audience="painthome" />;
}
