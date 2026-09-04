import localFont from "next/font/local";
import { Martian_Mono } from "next/font/google";

/**
 * The marketing faces (brief §2), defined once so the marketing layout AND
 * the Settings → Showcase live preview (which renders the real ProjectPage
 * inside the staff shell) put the same variables on their wrapper.
 * Switzer is self-hosted from Fontshare's files (not on Google Fonts);
 * Martian Mono is money, references and small data labels only.
 */
export const switzer = localFont({
  src: [
    { path: "./fonts/switzer-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/switzer-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/switzer-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-switzer",
  display: "swap",
});

export const martian = Martian_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-martian",
  display: "swap",
});

/** The class names a wrapper needs for the marketing styles to resolve. */
export const marketingFontClass = `${switzer.variable} ${martian.variable}`;
