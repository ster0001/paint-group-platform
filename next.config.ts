import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
