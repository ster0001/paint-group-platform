import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUncheckedSupabaseRead from "./eslint-rules/no-unchecked-supabase-read.mjs";
import uncheckedReadBaseline from "./eslint-rules/unchecked-read-baseline.json" with { type: "json" };

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
  // A Supabase list read that drops its `error` renders as "there is nothing
  // here" — the 16 Sep 2026 invoicing outage, where a column that had not been
  // migrated to production emptied the whole ledger on screen. The rule is a
  // per-file RATCHET over the 180 reads that already did this: a new one, or a
  // new file, is an error. Lower a count when you fix some; never raise one.
  // See eslint-rules/no-unchecked-supabase-read.mjs.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.contract.test.ts"],
    plugins: { local: { rules: { "no-unchecked-supabase-read": noUncheckedSupabaseRead } } },
    rules: {
      "local/no-unchecked-supabase-read": ["error", uncheckedReadBaseline],
    },
  },
]);

export default eslintConfig;
