import type { Metadata } from "next";
import localFont from "next/font/local";
import { Martian_Mono } from "next/font/google";
import "./marketing.css";

/**
 * The marketing site's shell (brief §2). Switzer is the production face —
 * Fontshare, self-hosted through next/font/local (it is not on Google Fonts);
 * Martian Mono is money, references and small data labels only.
 * Both `display: swap` so the H1 (the LCP element) paints on a fallback.
 */
const switzer = localFont({
  src: [
    { path: "./fonts/switzer-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/switzer-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/switzer-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-switzer",
  display: "swap",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-martian",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Paint Group — see what it costs to paint your home or business",
  description:
    "Type your address and see a real painting price range in about ten minutes. Homes and businesses across Melbourne, confirmed by a person before we start.",
  // §8: the new site lives on the noindex test subdomain until the flip.
  // Session 7 adds the X-Robots-Tag header; this covers the page itself.
  robots: { index: false, follow: false },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`mk ${switzer.variable} ${martian.variable}`}>{children}</div>;
}
