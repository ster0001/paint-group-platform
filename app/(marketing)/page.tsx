import type { Metadata } from "next";
import HomePage, { homeMetadata } from "./HomePage";

/**
 * The residential homepage (docs/briefs/homepage-v2-build-brief.md; session
 * 8: one HomePage, two audiences — the business one is ./business/page.tsx).
 * Static with ISR: the data is the showcase table plus Settings → Website
 * and site_content; every save action revalidates "/".
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata("home");
}

export default function Page() {
  return <HomePage audience="home" />;
}
