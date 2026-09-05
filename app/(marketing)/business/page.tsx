import type { Metadata } from "next";
import HomePage, { homeMetadata } from "../HomePage";

/**
 * The business homepage (session 8 §2). The proxy serves the commercial
 * domain's root from this route and 301s /business on the residential
 * domain to it; with no commercial domain configured (dev, the C1 test
 * server, the Settings preview) it is simply /business.
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata("business");
}

export default function Page() {
  return <HomePage audience="business" />;
}
