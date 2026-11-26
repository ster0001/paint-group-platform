import type { Metadata } from "next";
import { getAudience } from "@/lib/marketing/audienceServer";
import { getBrand } from "@/lib/marketing/brandServer";
import NotFoundView from "./_components/NotFoundView";

/**
 * The marketing 404 — an unpublished or unknown /work slug lands here. The
 * view is shared with the root 404 (./_components/NotFoundView). The title
 * is the brand's and is the page's ONLY title (SEO foundations, 26 Nov 2026:
 * an inline <title> came second to the layout's and lost).
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand(await getAudience());
  return { title: `Page not found | ${brand.name}`, robots: { index: false, follow: false } };
}

export default async function MarketingNotFound() {
  return <NotFoundView audience={await getAudience()} />;
}
