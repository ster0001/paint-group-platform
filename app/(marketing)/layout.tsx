import type { Metadata } from "next";
import { marketingFontClass } from "./fonts";
import "./marketing.css";

/**
 * The marketing site's shell (brief §2). Fonts come from ./fonts.ts (shared
 * with the Settings → Showcase preview); styles are scoped under `.mk`.
 */
export const metadata: Metadata = {
  title: "Paint Group — see what it costs to paint your home or business",
  description:
    "Type your address and see a real painting price range in about ten minutes. Homes and businesses across Melbourne, confirmed by a person before we start.",
  // §8: the new site lives on the noindex test subdomain until the flip.
  // Session 7 adds the X-Robots-Tag header; this covers the page itself.
  robots: { index: false, follow: false },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`mk ${marketingFontClass}`}>{children}</div>;
}
