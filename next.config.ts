import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's project root to this directory. Without it, Turbopack
  // infers the root from the GIT repository, which breaks git worktrees:
  // a worktree's .git file points at the primary checkout, so module
  // resolution walks into ../<primary>/node_modules and panics with
  // "leaves the filesystem root". Explicit root is correct everywhere.
  turbopack: { root: __dirname },
};

export default nextConfig;
