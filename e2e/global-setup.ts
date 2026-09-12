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

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PRODUCTION_REF_VAR = "PRODUCTION_SUPABASE_REF";

/** Where this run's start marker is written, for global-teardown.ts. */
export const RUN_MARKER_FILE = join(tmpdir(), "pg-e2e-run-marker.json");

/**
 * WHAT IS PRODUCTION? — named once, by the environment, and never guessed.
 *
 * This has been wrong twice, in opposite directions, and both are why it now
 * looks like this:
 *
 *   1. It read ONLY `.env.local` at process.cwd(). A git worktree has no
 *      `.env.local` (gitignored, lives in the main checkout), so in every
 *      worktree — which is how this repo is actually worked — it resolved to
 *      null and A1-07 was INERT. A guard that cannot identify its target and
 *      carries on is not a guard.
 *
 *   2. The fix for that was a pinned constant as a fallback. That made the
 *      guard's answer depend on which of two sources happened to win, and it
 *      still inferred "production" from `.env.local` first. On 11 Sep a
 *      worktree whose `.env.local` held the TEST project was told its own test
 *      stack WAS production and every e2e run was refused. The guard was now
 *      wrong in the safe direction, which is luck, not design.
 *
 * So: one explicitly named variable, and NO fallback of any kind. Unset,
 * blank, or not shaped like a project ref all REFUSE THE RUN. Failing closed
 * costs a one-line export; failing open cost 552 rows in production
 * `wizard_drafts`.
 *
 * It is not a secret — a project ref appears in every public URL the app
 * serves — so it belongs in `.env.test.local`, `.env.local` and the CI
 * workflow's plain `env:` block, beside the values it protects.
 */
function productionRef(): string {
  const ref = (process.env[PRODUCTION_REF_VAR] ?? "").trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(
      `REFUSED: ${PRODUCTION_REF_VAR} is ${ref ? `not a project ref (${ref})` : "not set"}.\n\n` +
        "e2e cannot tell which project is production, so it will not run at all —\n" +
        "these specs create, mutate and delete rows.\n\n" +
        "FIX: load a project env file — both carry the variable:\n\n" +
        "    set -a; source .env.test.local; set +a\n\n" +
        "IF YOU JUST MADE A WORKTREE: it has no .env.local or .env.test.local.\n" +
        "Both are gitignored and live in the main checkout — copy them across:\n\n" +
        "    cp ../paint-group-platform/.env.test.local .\n\n" +
        "IN CI: it is a plain `env:` value on the e2e job in .github/workflows/ci.yml.\n\n" +
        "The value is the PRODUCTION project's ref, the 20 characters in its\n" +
        "Supabase dashboard URL (/dashboard/project/<ref>). It is not a secret.\n",
    );
  }
  return ref;
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

  // ---- C7c: the tripwire, and this run's marker ---------------------------
  //
  // Counts the run-created users on the test project BEFORE anything runs
  // and logs them EVERY time (⚑44) — the visible number is what catches
  // drift; the thresholds are only the backstop. The same call reads the
  // database clock, which becomes the marker the teardown deletes by. Exit 2
  // is over the fail threshold; exit 3 is a refusal (unnameable target, or
  // production). Both stop the run — a suite that cannot clean up after
  // itself must not add to the pile.
  {
    const r = spawnSync(process.execPath, ["scripts/c1/hygiene.mjs", "count", "--json"], {
      encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"], timeout: 60_000,
    });
    if (r.status === 3) throw new Error("REFUSED: the hygiene guard would not name the test project — see above. e2e does not run against a target it cannot clean.");
    if (r.status === 2) throw new Error("REFUSED: the test project is over the tripwire's fail threshold — run the sweep first (node scripts/c1/hygiene.mjs sweep, or .github/workflows/hygiene.yml).");
    if (r.status !== 0) throw new Error(`The hygiene tripwire could not count the test project (exit ${r.status}). Is E2E_DATABASE_URL / C1_DATABASE_URL set?`);
    const last = (r.stdout ?? "").trim().split("\n").pop() ?? "";
    const parsed = JSON.parse(last) as { now: string; anonymous: number; e2eLogins: number };
    process.env.E2E_RUN_STARTED_AT = parsed.now;
    writeFileSync(RUN_MARKER_FILE, JSON.stringify({ startedAt: parsed.now, anonymous: parsed.anonymous, e2eLogins: parsed.e2eLogins }));
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
