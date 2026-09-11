/**
 * C1 env loading + the production tripwire.
 *
 * Everything C1 reads comes from `.env.test.local` — a file that exists only
 * for the test stack. The tripwire refuses to run against anything that
 * looks like the production project: the prod URL lives in .env.local, and
 * no C1 tool will proceed if the target matches it.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Load .env.test.local into process.env (it wins over anything inherited). */
export function loadTestEnv() {
  const testEnv = parseEnvFile(resolve(process.cwd(), ".env.test.local"));
  for (const [k, v] of Object.entries(testEnv)) process.env[k] = v;
  return testEnv;
}

export const PRODUCTION_REF_VAR = "PRODUCTION_SUPABASE_REF";

/**
 * The production project ref — from the environment, never inferred.
 *
 * This used to read `.env.local` and call whatever it found there
 * "production". In a worktree there is no such file, so it returned null and
 * `refuseProduction` below became a no-op — `if (ref && ...)` simply skipped.
 * And when a worktree DID have one holding the test project, it refused the
 * test project instead. Both failure modes are gone: unset refuses, malformed
 * refuses, and nothing is guessed.
 */
export function productionRef() {
  const ref = (process.env[PRODUCTION_REF_VAR] ?? "").trim();
  if (/^[a-z0-9]{20}$/.test(ref)) return ref;
  console.error(
    `\nREFUSED: ${PRODUCTION_REF_VAR} is ${ref ? `not a project ref (${ref})` : "not set"}.\n\n` +
      "C1 tools cannot tell which project is production, so they will not run.\n\n" +
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

/** Hard stop if a C1 target smells like production. */
export function refuseProduction(target) {
  const ref = productionRef();
  if (String(target).includes(ref)) {
    console.error(
      `REFUSED: the target contains the PRODUCTION project ref (${ref}). ` +
        "C1 tools only ever run against the test project.",
    );
    process.exit(1);
  }
}
