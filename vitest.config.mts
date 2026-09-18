import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Same `@/` alias as tsconfig, so tests import modules by the path the app
    // uses rather than a parallel set of relative paths that can drift.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws on import anywhere that is not a React server
      // bundle — including Vitest. Modules that read the service-role key
      // carry it as a tripwire; tests get an empty module instead.
      "server-only": fileURLToPath(new URL("./lib/testing/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    // Unit tests only. The Playwright specs under e2e/ drive a real browser
    // against a real database and are run deliberately (`npm run test:e2e`).
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
