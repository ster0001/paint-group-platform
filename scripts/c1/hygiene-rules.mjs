/**
 * C7c · test-project hygiene — the PURE rules.
 *
 * Everything here is a function of its arguments and is unit-tested from
 * lib/testing/hygiene.test.ts. The runner (hygiene.mjs) supplies the
 * database; this file decides what is allowed and what an FK means.
 *
 * Why it is split: the teardown DELETES, so the parts that decide whether it
 * may run at all, and whom it may never touch, must be provable without a
 * database in the loop.
 */

/** @type {{ warnRows: number, failRows: number, sweepAgeDays: number, batch: number, chunk: number, budgetMinutes: number }} */
export const DEFAULTS = Object.freeze({
  /** ⚑44 — logged every run regardless; these are only the backstop. */
  warnRows: 5_000,
  failRows: 20_000,
  /** ⚑43 */
  sweepAgeDays: 3,
  /** Users per sweep run. 200 to start (brief step 2): a single auth-user
   * delete measured 13.5 s on this project before its hot FKs were indexed. */
  batch: 200,
  /** Users per SQL round trip inside a batch. */
  chunk: 25,
  budgetMinutes: 20,
});

/** Exit codes the runner uses, so a caller can tell a refusal from a failure. */
export const EXIT = Object.freeze({ ok: 0, error: 1, tripwire: 2, refused: 3 });

/** The 20-character project ref inside any Supabase URL or connection string. */
export function projectRefOf(url) {
  const m = String(url ?? "").match(/(?:^|[^a-z0-9])([a-z0-9]{20})(?:[^a-z0-9]|$)/);
  return m ? m[1] : null;
}

/**
 * MAY THIS RUN AT ALL? The teardown deletes, so it is at least as paranoid as
 * e2e/global-setup.ts: the production ref must be NAMED (never inferred), the
 * database must be nameable, it must not be production, and it must be the
 * same project the app under test is wired to — reading one database while
 * the browser writes another is exactly how production collected 552 drafts.
 * @param {{ dbUrl?: string | null, siteUrl?: string | null, productionRef?: string | null }} input
 * @returns {{ ok: true, ref: string } | { ok: false, reason: string }}
 */
export function checkTarget({ dbUrl, siteUrl, productionRef }) {
  const prod = String(productionRef ?? "").trim();
  if (!/^[a-z0-9]{20}$/.test(prod)) {
    return { ok: false, reason: `PRODUCTION_SUPABASE_REF is ${prod ? `not a project ref (${prod})` : "not set"} — nothing runs until production is named.` };
  }
  if (!dbUrl) {
    return { ok: false, reason: "no database connection string — set E2E_DATABASE_URL (CI) or C1_DATABASE_URL (.env.test.local)." };
  }
  const ref = projectRefOf(dbUrl);
  if (!ref) return { ok: false, reason: "the database connection string names no project ref — an unidentifiable target is never treated as safe." };
  if (ref === prod) return { ok: false, reason: `the database IS the production project (${prod}).` };
  if (siteUrl) {
    const app = projectRefOf(siteUrl);
    if (app !== ref) {
      return { ok: false, reason: `the database (${ref}) and the app's Supabase URL (${app ?? "unknown"}) are different projects.` };
    }
  }
  return { ok: true, ref };
}

/**
 * The seeded logins (staff, contractor, customer) are NEVER deleted. They
 * arrive as ids resolved from the E2E_*_EMAIL variables; an empty list means
 * the resolution failed, and a teardown that cannot name whom to spare does
 * not delete anything. `profiles.id` is the one ON DELETE CASCADE in the
 * fan-out — deleting a seeded auth user would silently take its profile.
 * @param {Array<{ id?: string, email?: string } | null | undefined> | null | undefined} resolved
 * @returns {string[]}
 */
export function seededExclusion(resolved) {
  const ids = (resolved ?? []).map((r) => r?.id).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) {
    throw new Error("REFUSED: no seeded login resolved to a user id — the exclusion list is empty, so nothing is deleted.");
  }
  return ids;
}

/**
 * Columns whose row BELONGS to the user even though the FK says NO ACTION.
 * `estimates.created_by` is the common case: an anonymous wizard customer
 * writes it on their first save, so the estimate chain must go before the
 * user or Postgres refuses the delete (brief step 2).
 */
export const OWNED = Object.freeze([
  "public.estimates.created_by",
  "public.wizard_leads.user_id",
  "public.estimate_sources.created_by",
  "public.extraction_runs.created_by",
  "public.defect_observations.confirmed_by",
]);

/**
 * What to do with a foreign key when its parent rows are being deleted.
 *
 *   CASCADE            → "descend": Postgres deletes the child rows; we only
 *                        clear the child's OWN restricting children first.
 *   SET NULL / DEFAULT → "leave": Postgres handles it.
 *   RESTRICT           → "purge": the schema says the child depends on the
 *                        parent (accounts → estimates, estimates → invoices).
 *   NO ACTION          → "purge" when the column is owned or NOT NULL;
 *                        otherwise "nullify" — an audit column
 *                        (site_check_cleared_by) does not make a row ours.
 * @param {{ child: string, column: string, rule: string, nullable?: boolean }} fk
 * @param {readonly string[]} [owned]
 * @returns {"descend" | "leave" | "purge" | "nullify"}
 */
export function fkAction(fk, owned = OWNED) {
  const rule = String(fk.rule ?? "").toUpperCase();
  if (rule === "CASCADE") return "descend";
  if (rule === "SET NULL" || rule === "SET DEFAULT") return "leave";
  if (rule === "RESTRICT") return "purge";
  const key = `${fk.child}.${fk.column}`;
  if (owned.includes(key) || fk.nullable === false) return "purge";
  return "nullify";
}

/**
 * The tripwire verdict. The line is produced whatever the numbers are —
 * ⚑44: a tripwire that says nothing until it fails is one nobody reads.
 * @param {{ anonymous?: number, e2eLogins?: number } | null | undefined} counts
 * @param {{ warnRows: number, failRows: number }} [thresholds]
 * @returns {{ level: "ok" | "warn" | "fail", total: number, line: string }}
 */
export function verdict(counts, thresholds = DEFAULTS) {
  const anonymous = Number(counts?.anonymous) || 0;
  const e2eLogins = Number(counts?.e2eLogins) || 0;
  const total = anonymous + e2eLogins;
  const line = `test-project rows · anonymous users ${anonymous.toLocaleString("en-AU")} · pg.e2e.* logins ${e2eLogins.toLocaleString("en-AU")} · total ${total.toLocaleString("en-AU")} (warn ${thresholds.warnRows.toLocaleString("en-AU")} · fail ${thresholds.failRows.toLocaleString("en-AU")})`;
  const level = total > thresholds.failRows ? "fail" : total > thresholds.warnRows ? "warn" : "ok";
  return { level, total, line };
}

/** @param {{ verb: string, created?: number | null, deleted: number, left: number, seconds: number, byTable?: Record<string, number> }} input */
export function summaryLine({ verb, created = null, deleted, left, seconds, byTable = {} }) {
  const tables = Object.entries(byTable).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([t, n]) => `${t.replace(/^public\./, "")} ${n}`).join(", ");
  return `${verb}: ${created != null ? `created ${created}, ` : ""}deleted ${deleted} user${deleted === 1 ? "" : "s"}, left ${left}, ${seconds.toFixed(1)}s${tables ? ` — rows: ${tables}` : ""}`;
}

/**
 * Minimal argv parsing: `--key value` and `--flag`.
 * @param {string[]} argv
 * @returns {Record<string, string | true | string[]> & { _: string[] }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | true | string[]> & { _: string[] }} */
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
