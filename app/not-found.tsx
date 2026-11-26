import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAudience } from "@/lib/marketing/audienceServer";
import { getBrand } from "@/lib/marketing/brandServer";
import { isMarketingHost } from "@/lib/marketing/hosts";
import { marketingFontClass } from "./(marketing)/fonts";
import NotFoundView from "./(marketing)/_components/NotFoundView";
import "./(marketing)/marketing.css";

/**
 * The 404 for any address no route answers (go-live check, 25 Nov 2026).
 *
 * SEO foundations (26 Nov 2026): on a website host it is that site's own
 * 404 — the brand's nav, footer and name in the title, links to the home
 * page and to /work. The 25 Nov fix put a <title> in the body, but the root
 * layout's "Paint Group Platform" still came first in the document, so that
 * is what browsers and Google showed on painthome.com.au. The title is now
 * metadata, read from the host. On the platform address (the login) it
 * stays plain and names no shopfront.
 */
async function onWebsite(): Promise<boolean> {
  return isMarketingHost((await headers()).get("host"));
}

export async function generateMetadata(): Promise<Metadata> {
  if (!(await onWebsite())) return { title: "Page not found", robots: { index: false, follow: false } };
  const brand = await getBrand(await getAudience());
  return { title: `Page not found | ${brand.name}`, robots: { index: false, follow: false } };
}

export default async function NotFound() {
  if (await onWebsite()) {
    return (
      <div className={`mk ${marketingFontClass}`}>
        <NotFoundView audience={await getAudience()} />
      </div>
    );
  }
  return (
    <main style={{ minHeight: "70svh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <p style={{ fontSize: 13, letterSpacing: ".08em", color: "#6b7280" }}>404</p>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "8px 0 12px" }}>That page isn&rsquo;t here.</h1>
        <p style={{ color: "#4b5563", marginBottom: 24 }}>The address may be mistyped, or the page may have moved.</p>
        <Link href="/" style={{ textDecoration: "underline" }}>Back to the home page</Link>
      </div>
    </main>
  );
}
