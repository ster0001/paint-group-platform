import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where a seed/fixture script is allowed to write.
 *
 * F1-03 (audit 2026-08-28, found the hard way): six scripts under scripts/
 * resolved their connection by reading `.env.local` — production — and IGNORED
 * the environment entirely. Exporting the test project's values did nothing;
 * the script wrote to production regardless. On 28 Aug that turned
 * `wizard_public` off and reset `wizard_limits.maxEstimatesPerVisitor` from the
 * proving window's 500 back to 2, on the live site, while the operator believed
 * they were seeding the test project.
 *
 * It is also the likeliest explanation for A3-09 — 638 of 648 production users
 * being driver output. `create-test-contractors`, `create-test-customer` and
 * `seed-demo-customer` all create accounts, and all of them pointed at
 * production by construction. The test data did not leak in; these scripts put
 * it there.
 *
 * The rule now:
 *
 *   1. `process.env` wins. Export the target and that is the target.
 *   2. Otherwise fall back to `.env.local`, which is what a bare run has always
 *      meant and what Tom's own workflows expect.
 *   3. Writing to PRODUCTION requires `SEED_ALLOW_PRODUCTION=1`, stated out
 *      loud, every time.
 *
 * Rule 3 is the whole point. Deliberately seeding production stays possible —
 * it is sometimes the actual job — but it can no longer happen by accident, or
 * because a script's connection logic disagreed with its caller's intent.
 */

/**
 * WHAT IS PRODUCTION? — named by the environment, never pinned here.
 *
 * Same rule as `e2e/global-setup.ts`: one explicitly named variable, no
 * fallback, and an unset or malformed value REFUSES rather than guesses.
 * A seed script that cannot tell which project is production must not write
 * to any of them.
 *
 * Not a secret — a project ref is in every public URL the app serves — so it
 * lives in `.env.local` / `.env.test.local` beside the values it protects.
 */
const PRODUCTION_REF_VAR = "PRODUCTION_SUPABASE_REF";

function productionRefOrRefuse(scriptName) {
  const ref = (process.env[PRODUCTION_REF_VAR] ?? "").trim();
  if (/^[a-z0-9]{20}$/.test(ref)) return ref;
  console.error(
    `\nREFUSED: ${PRODUCTION_REF_VAR} is ${ref ? `not a project ref (${ref})` : "not set"}.\n\n` +
    `${scriptName} creates or overwrites data and cannot tell which project is\n` +
    "production, so it will not write to any of them.\n\n" +
    "FIX: load a project env file — both carry the variable:\n\n" +
    "    set -a; source .env.test.local; set +a\n\n" +
    "IF YOU JUST MADE A WORKTREE: it has no .env.local or .env.test.local.\n" +
    "Both are gitignored and live in the main checkout — copy them across:\n\n" +
    "    cp ../paint-group-platform/.env.test.local .\n\n" +
    "The value is the PRODUCTION project's ref, the 20 characters in its\n" +
    "Supabase dashboard URL (/dashboard/project/<ref>). It is not a secret.\n",
  );
  process.exit(1);
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The ref in a Supabase URL, or null. */
export function refOf(url) {
  return String(url ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

/**
 * Resolve the target, refusing production unless explicitly allowed.
 *
 * @param {string} scriptName  named in the refusal, so the operator knows what stopped
 * @returns {{url: string, anonKey: string, serviceKey: string|undefined, ref: string, isProduction: boolean, source: string}}
 */
export function resolveSeedTarget(scriptName) {
  const fromProcess = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const file = parseEnvFile(resolve(process.cwd(), ".env.local"));

  const url = fromProcess || file.NEXT_PUBLIC_SUPABASE_URL;
  const source = fromProcess ? "the environment" : ".env.local";
  if (!url) {
    console.error(`${scriptName}: no NEXT_PUBLIC_SUPABASE_URL in the environment or .env.local.`);
    process.exit(1);
  }

  const anonKey = (fromProcess ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null)
    || file.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = (fromProcess ? process.env.SUPABASE_SERVICE_ROLE_KEY : null)
    || file.SUPABASE_SERVICE_ROLE_KEY;

  /**
   * AN UNREADABLE TARGET REFUSES. It used to become the string "unknown",
   * which then compared unequal to the production ref — so a URL this guard
   * could not parse was treated as definitely-not-production and written to.
   * Supabase supports CUSTOM DOMAINS, so production reached through one
   * (https://db.paintgroup.com.au/...) parsed to null and walked straight
   * past the check. "I could not identify it" is not "it is safe".
   */
  const ref = refOf(url);
  if (!ref) {
    console.error(
      `\nREFUSED: ${scriptName} cannot identify the project behind ${url},\n` +
      `resolved from ${source}.\n\n` +
      "It expects https://<ref>.supabase.co. A custom domain or a proxy hides the\n" +
      "project ref, and this script will not create or overwrite data it cannot\n" +
      "name — an unidentified target is not a safe one.\n\n" +
      "Use the project's own supabase.co URL:\n\n" +
      "    set -a; source .env.test.local; set +a\n",
    );
    process.exit(1);
  }
  const isProduction = ref === productionRefOrRefuse(scriptName);

  if (isProduction && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error(
      `\nREFUSED: ${scriptName} would write to the PRODUCTION project (${ref}),\n` +
      `resolved from ${source}.\n\n` +
      "This script creates or overwrites data. If you meant the test project,\n" +
      "load its values first:\n\n" +
      "    set -a; source .env.test.local; set +a\n\n" +
      "If you genuinely mean production, say so:\n\n" +
      `    SEED_ALLOW_PRODUCTION=1 <your command>\n`,
    );
    process.exit(1);
  }

  console.log(
    `${scriptName} → ${ref}${isProduction ? "  ⚠ PRODUCTION (allowed explicitly)" : ""}  [from ${source}]`,
  );
  return { url, anonKey, serviceKey, ref, isProduction, source };
}
