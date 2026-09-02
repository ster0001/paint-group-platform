import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // The assistant gateway is SERVER-ONLY (assistant brief S1 acceptance):
  // pages and components never import it — they call app/api/agent/**.
  // `server-only` also fails the build if a client component slips through;
  // this rule fails lint first, with a message.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/lib/agent/gateway", "**/lib/agent/model-anthropic", "**/lib/agent/store-supabase"],
          message: "The assistant gateway is server-only. Reach it through an app/api/agent/** route handler, never from a page or component.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
