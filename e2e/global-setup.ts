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
 * THE HOLE THAT LEFT (11 Sep 2026). A1-07 checks this process's own
 *   NEXT_PUBLIC_SUPABASE_URL — the database the FIXTURES talk to. It never
 *   checked the app the BROWSER drives. `playwright.config.ts` defaulted
 *   `baseURL` to http://localhost:3000 with `reuseExistingServer: true`, and a
 *   dev server left running from the main checkout loads `.env.local`, i.e.
 *   production. So: export the test project, run `npx playwright test <spec>`,
 *   watch the tripwire say "safe" — and every spec drives a PRODUCTION-backed
 *   app while the fixtures read the test one. It wrote 552 of the 799 rows in
 *   production `wizard_drafts`, all @example.com, and poisoned the CRM drop-out
 *   funnel that reads that table.
 *
 *   Three layers now, because one was demonstrably not enough:
 *     1. E2E_BASE_URL must be SET. No default. The accident was the default.
 *     2. The named app is PROBED for the production project ref before any
 *        spec runs. Naming a production-backed URL is refused too.
 *     3. E2E_ALLOW_PRODUCTION=1 is the deliberate escape hatch — read-only runs
 *        like e2e/perf-roundtrip.spec.ts exist and are legitimate.
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

/**
 * The production project ref.
 *
 * MUST match PRODUCTION_REF in scripts/seed-target.mjs — `e2e/production-ref.test.ts`
 * fails if the two drift. Two guards disagreeing about what production IS would
 * be worse than one guard.
 *
 * Why a constant and not just .env.local (11 Sep 2026): this read ONLY
 * `.env.local` at process.cwd(), and a git worktree does not have one — that
 * file is gitignored and lives in the main checkout. So in every worktree,
 * which is how this repo is actually worked, `productionRef()` returned null
 * and A1-07 was INERT: the tripwire that exists to refuse production could not
 * tell what production was, and let everything through in silence. A guard that
 * fails open when it cannot identify its target is not a guard.
 */
const PRODUCTION_REF = "llmrvgdequpmzzuaxdhq";

/** The production project ref — the local file when there is one, else the constant. */
function productionRef(): string {
  const url = parseEnvFile(resolve(process.cwd(), ".env.local")).NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? PRODUCTION_REF;
}

const REQUIRED_IN_CI = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_STAFF_EMAIL", "E2E_STAFF_PASSWORD",
  "E2E_CONTRACTOR_EMAIL", "E2E_CONTRACTOR_PASSWORD",
  "E2E_CUSTOMER_EMAIL", "E2E_CUSTOMER_PASSWORD",
];

/**
 * Which Supabase project the APP at `base` is wired to.
 *
 * NEXT_PUBLIC_* values are inlined into what the app serves, so the project ref
 * comes back in the HTML of any page that hands the browser a Supabase client.
 * `/estimate` does; `/login` does not, which is why this asks for more than one
 * and takes the first that answers.
 *
 * Returns null when it cannot tell — a server that is down, a page that changed.
 * That fails OPEN, deliberately: layer 1 has already removed the accidental
 * case, and refusing a run because a probe could not reach a page would train
 * people to set the escape hatch permanently, which is worse.
 */
async function appProjectRef(base: string): Promise<string | null> {
  for (const path of ["/estimate", "/", "/login"]) {
    try {
      const res = await fetch(new URL(path, base), { redirect: "follow" });
      const ref = (await res.text()).match(/([a-z0-9]{16,})\.supabase\.co/)?.[1];
      if (ref) return ref;
    } catch { /* try the next one */ }
  }
  return null;
}

export default async function globalSetup(): Promise<void> {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const allowProduction = process.env.E2E_ALLOW_PRODUCTION === "1";

  // ---- A1-07: never production -------------------------------------------
  const prod = productionRef();
  if (target.includes(prod) && !allowProduction) {
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

  // ---- 1. the browser needs a NAMED app ----------------------------------
  const base = process.env.E2E_BASE_URL ?? "";
  if (!base) {
    throw new Error(
      "REFUSED: E2E_BASE_URL is not set.\n\n" +
        "playwright.config.ts used to default to http://localhost:3000, and a dev server\n" +
        "left running from the main checkout is pointed at PRODUCTION. That default wrote\n" +
        "552 rows into production wizard_drafts while this very tripwire reported 'safe',\n" +
        "because it only ever checked the database the FIXTURES talk to.\n\n" +
        "Say which app the browser should drive:\n\n" +
        "    ./scripts/c1/run-e2e.sh [spec…]        (starts its own on :3101)\n" +
        "    E2E_BASE_URL=http://localhost:3101 npx playwright test [spec…]\n",
    );
  }

  // ---- 2. and that app must not be production ----------------------------
  if (!allowProduction) {
    const appRef = await appProjectRef(base);
    if (appRef && appRef === prod) {
      throw new Error(
        `REFUSED: ${base} is serving the PRODUCTION project (${prod}).\n\n` +
          "The fixtures are pointed at the test project, so this run would read one\n" +
          "database and write to another — which is how production collected 552\n" +
          "@example.com drafts.\n\n" +
          "Start a server on the test stack (./scripts/c1/run-e2e.sh), or if you\n" +
          "genuinely mean production and the specs are read-only:\n\n" +
          "    E2E_ALLOW_PRODUCTION=1 E2E_BASE_URL=" + base + " npx playwright test …\n",
      );
    }
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
