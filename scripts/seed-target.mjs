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

const PRODUCTION_REF = "llmrvgdequpmzzuaxdhq";

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

  const ref = refOf(url) ?? "unknown";
  const isProduction = ref === PRODUCTION_REF;

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
