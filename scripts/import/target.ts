/**
 * Where an import loader is allowed to write — the one guard both loaders share.
 *
 * Same law as scripts/seed-target.mjs and scripts/c1/env.mjs: production is
 * NAMED by PRODUCTION_SUPABASE_REF and never inferred; a target that cannot
 * be identified refuses; writing to production needs IMPORT_ALLOW_PRODUCTION=1
 * said out loud. On top of that, the two connections a loader holds — the
 * REST API (supabase-js, for lib/accounts/link.ts and the facts rebuild) and
 * Postgres (pg, for transactions and the import switch) — must name the SAME
 * project, or the run stops: reading one database while writing another is
 * exactly how the test project's e2e drove production once.
 *
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   the REST target
 *   IMPORT_DATABASE_URL (or C1_DATABASE_URL for the test project)   Postgres
 *   PRODUCTION_SUPABASE_REF                                 which project is production
 *
 * The test project is what `set -a; source .env.test.local; set +a` loads.
 * For production, export the production URL/key from .env.local and the
 * Dashboard → Connect → Session pooler string as IMPORT_DATABASE_URL.
 */

export type ImportTarget = {
  url: string;
  serviceKey: string;
  databaseUrl: string;
  ref: string;
  isProduction: boolean;
};

export function projectRefOf(s: string | undefined | null): string | null {
  const m = String(s ?? "").match(/(?:^|[^a-z0-9])([a-z0-9]{20})(?:[^a-z0-9]|$)/);
  return m ? m[1] : null;
}

/** Refuses with an explanation rather than guessing. Never reads .env.local itself. */
export function resolveImportTarget(scriptName: string, opts: { needsDatabase: boolean }): ImportTarget {
  const fail = (msg: string): never => {
    console.error(`\nREFUSED: ${scriptName} — ${msg}\n`);
    process.exit(3);
  };
  const prod = (process.env.PRODUCTION_SUPABASE_REF ?? "").trim();
  if (!/^[a-z0-9]{20}$/.test(prod)) {
    fail(`PRODUCTION_SUPABASE_REF is ${prod ? `not a project ref (${prod})` : "not set"}. It names the production project (the 20 characters in its dashboard URL) and lives in .env.local / .env.test.local. Load one: set -a; source .env.test.local; set +a`);
  }
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be in the environment.");
  const ref = projectRefOf(url);
  if (!ref) fail(`cannot identify the project behind ${url} (expects https://<ref>.supabase.co; a custom domain hides it).`);
  const keyRef = refInJwt(serviceKey);
  if (keyRef && keyRef !== ref) fail(`the service key belongs to project ${keyRef}, the URL names ${ref}.`);

  // IMPORT_DATABASE_URL for a deliberate run; C1_DATABASE_URL is the test
  // project on a Mac, E2E_DATABASE_URL the same project in CI.
  const databaseUrl = (process.env.IMPORT_DATABASE_URL ?? process.env.C1_DATABASE_URL ?? process.env.E2E_DATABASE_URL ?? "").trim();
  if (opts.needsDatabase) {
    if (!databaseUrl) fail("IMPORT_DATABASE_URL (or C1_DATABASE_URL / E2E_DATABASE_URL for the test project) is needed — the Postgres connection string from Dashboard → Connect → Session pooler.");
    const dbRef = projectRefOf(databaseUrl);
    if (!dbRef) fail("the database connection string names no project ref — an unidentifiable target is never safe.");
    if (dbRef !== ref) fail(`the database (${dbRef}) and the API URL (${ref}) are different projects.`);
  }

  const isProduction = ref === prod;
  if (isProduction && process.env.IMPORT_ALLOW_PRODUCTION !== "1") {
    fail(`the target is the PRODUCTION project (${ref}). If that is the intention, say so: IMPORT_ALLOW_PRODUCTION=1 ${scriptName} …`);
  }
  console.log(`${scriptName} → ${ref}${isProduction ? "  ⚠ PRODUCTION (allowed explicitly)" : "  (test project)"}`);
  return { url, serviceKey, databaseUrl, ref: ref!, isProduction };
}

/** The `ref` claim inside a legacy Supabase JWT, or null for a new-style key. */
function refInJwt(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}
