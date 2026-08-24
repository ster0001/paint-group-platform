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
};

export default nextConfig;
