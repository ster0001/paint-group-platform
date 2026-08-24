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

/** The production project ref, read from .env.local — the thing to refuse. */
export function productionRef() {
  const prod = parseEnvFile(resolve(process.cwd(), ".env.local"));
  const url = prod.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

/** Hard stop if a C1 target smells like production. */
export function refuseProduction(target) {
  const ref = productionRef();
  if (ref && String(target).includes(ref)) {
    console.error(
      `REFUSED: the target contains the PRODUCTION project ref (${ref}). ` +
        "C1 tools only ever run against the test project.",
    );
    process.exit(1);
  }
}
