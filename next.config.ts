import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Homepage brief §8: while the new site lives on new.paintgroup.com.au,
  // every page carries `X-Robots-Tag: noindex, nofollow` (on top of the
  // page-level robots metadata) so Google never sees two Paint Group sites.
  // The flip: set SITE_INDEXABLE=1 in the Vercel project env and redeploy.
  async headers() {
    // Baseline browser hardening on every response (18 Sep 2026 security
    // audit — there were none before). No page here is meant to be framed by
    // another site, so clickjacking is shut with both the legacy header and
    // the CSP directive; nosniff stops a served upload being sniffed into a
    // script; the referrer policy keeps token-bearing paths (/e/<token>…)
    // out of third parties' logs when a customer follows an outbound link.
    // A full Content-Security-Policy is NOT set here: the pages carry inline
    // scripts (JSON-LD, Clarity, the tour) and third-party embeds, so it
    // needs a nonce pass first — tracked in the audit report.
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    const robots = process.env.SITE_INDEXABLE === "1" ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [{ source: "/:path*", headers: [...security, ...robots] }];
  },
  // Showcase photos live in the public showcase-media bucket and are served
  // through next/image (CLAUDE.md: images via next/image with Supabase
  // transforms) — the optimizer derives the sized variants the pages ask for
  // (800/1600 …) on request and caches them at the edge.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
  // Pin Turbopack's project root to this directory. Without it, Turbopack
  // infers the root from the GIT repository, which breaks git worktrees:
  // a worktree's .git file points at the primary checkout, so module
  // resolution walks into ../<primary>/node_modules and panics with
  // "leaves the filesystem root". Explicit root is correct everywhere.
  turbopack: { root: __dirname },
  // The PDF pipeline (lib/invoicing/pdf.ts) drives a real Chromium. These
  // stay OUT of the server bundle: @sparticuz/chromium ships a compressed
  // binary that must load from node_modules at runtime, and playwright-core
  // is a dev-only fallback that must not be resolved at build time.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "playwright-core"],
  // …but externalizing is only half of it on Vercel: the bin/ payload (the
  // ~66MB brotli-packed browser) is opened with fs reads at runtime, which
  // output file tracing cannot see — so it was never uploaded and EVERY
  // pdf render on prod died with "input directory …/bin does not exist"
  // (found 27 Aug via the /api/debug/pdf probe; every pdf_path was null).
  // Force the whole bin folder into every function that might render.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@sparticuz/chromium/bin/**"],
    // The help centre reads docs/help/** (markdown + screenshots + films) with
    // fs at request time — same blind spot for file tracing as the chromium
    // binary above, so the same fix.
    "/help/**": ["./docs/help/**"],
    "/portal/help/**": ["./docs/help/**"],
    "/api/help/**": ["./docs/help/**"],
  },
};

export default nextConfig;
