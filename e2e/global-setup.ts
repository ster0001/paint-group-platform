import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Runs once before any spec, from EVERY entry point — `npm run test:e2e`,
 * a bare `npx playwright test`, an IDE run, CI.
 *
 * Two jobs, both from the August 2026 audit:
 *
 * A1-07 · The production tripwire. `scripts/c1/run-e2e.sh` already refused to
 *   aim at production, but it is the long way to start a run. The short way —
 *   `npm run test:e2e` — inherited whatever was in the shell, which in a normal
 *   working session is `.env.local`, i.e. production. These specs MUTATE data.
 *   Guarding the config guards every door instead of one.
 *
 * A1-06 · Silent skips become loud ones under CI. 160 `test.skip(...)` calls
 *   across 74 spec files gate on a missing credential or env var. Locally that
 *   is a kindness: a partial setup gives a partial result. In CI it is a lie —
 *   the suite exits 0 having asserted almost nothing. Under `CI=1` a missing
 *   credential is a failed run, not a quiet pass.
 */

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The production project ref, from .env.local. Absent in CI — that is fine. */
function productionRef(): string | null {
  const url = parseEnvFile(resolve(process.cwd(), ".env.local")).NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

const REQUIRED_IN_CI = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_STAFF_EMAIL", "E2E_STAFF_PASSWORD",
  "E2E_CONTRACTOR_EMAIL", "E2E_CONTRACTOR_PASSWORD",
  "E2E_CUSTOMER_EMAIL", "E2E_CUSTOMER_PASSWORD",
];

export default function globalSetup(): void {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // ---- A1-07: never production -------------------------------------------
  const prod = productionRef();
  if (prod && target.includes(prod)) {
    throw new Error(
      `REFUSED: e2e is pointed at the PRODUCTION Supabase project (${prod}).\n` +
        "These specs create, mutate and delete rows. Run them on the test stack:\n" +
        "  ./scripts/c1/run-e2e.sh [spec…]\n" +
        "or export the test project's values before calling playwright directly.",
    );
  }
  if (!target) {
    throw new Error(
      "No NEXT_PUBLIC_SUPABASE_URL in the environment — e2e has no database to talk to.\n" +
        "Use ./scripts/c1/run-e2e.sh, which loads .env.test.local for you.",
    );
  }

  // ---- A1-06: in CI, a missing credential fails the run -------------------
  if (process.env.CI) {
    const missing = REQUIRED_IN_CI.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        "CI is missing e2e configuration, so specs would SKIP and the run would " +
          "pass having tested almost nothing.\n" +
          `Missing: ${missing.join(", ")}\n` +
          "Add these as repository secrets (test project only — never production).",
      );
    }
  } else if (!process.env.E2E_STAFF_EMAIL) {
    // Local: still a partial run, but say so rather than letting a wall of
    // green skips read as success.
    console.warn(
      "\n⚠  No E2E_* credentials in the environment — credential-gated specs " +
        "will SKIP.\n   A green result here does NOT mean the suite ran. " +
        "Use ./scripts/c1/run-e2e.sh for a real run.\n",
    );
  }
}
