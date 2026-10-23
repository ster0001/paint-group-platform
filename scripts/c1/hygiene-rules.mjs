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

/** @type {{ warnRows: number, failRows: number, sweepAgeDays: number, batch: number, chunk: number, sliceUsers: number, budgetMinutes: number, lockWaitMinutes: number, fixtureJobAgeDays: number }} */
export const DEFAULTS = Object.freeze({
  /** ⚑44 — logged every run regardless; these are only the backstop. */
  warnRows: 5_000,
  failRows: 20_000,
  /** ⚑43. Dropped 3 → 1 on 19 Sep 2026: the sweep now takes the SAME advisory
   * lock an e2e run does, so it can no longer overlap one, and the three-day
   * grace was only ever there to keep it away from live rows. A shorter window
   * is what stops a backlog forming in the first place. */
  sweepAgeDays: 1,
  /** Users per sweep run. Was 200 — chosen when a single auth-user delete
   * measured 13.5 s, before its hot FKs were indexed. Measured 19 Sep 2026 at
   * ~0.15 s/user, so 200 was costing 30 seconds of a 20-minute budget while
   * 8,290 users sat eligible: a 41-DAY tail that could never catch up. 1,000
   * is ~2.5 minutes, still a fraction of the budget. */
  batch: 1_000,
  /** Users per SQL round trip inside a batch. */
  chunk: 25,
  /** Users per SLICE — how much the sweep deletes before it drops the e2e run
   * lock and lets anyone waiting have the project. Two chunks: long enough to
   * be worth the round trip, short enough that a run never waits more than a
   * few seconds for housekeeping. */
  sliceUsers: 50,
  budgetMinutes: 20,
  /** How long a sweep waits for a running e2e suite before giving up. A suite
   * is 20-40 minutes and the sweep has all night; bouncing off the first
   * refusal is how you get a string of green sweeps that deleted nothing. */
  lockWaitMinutes: 12,
  /** Age gate for a service-role fixture JOB (fixtureJobSql). Wider than the
   * user sweep's: a fixture carries no user, so its age is the only thing that
   * says it is not a live run's — three days is well clear of any suite. */
  fixtureJobAgeDays: 3,
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
 * WHICH USERS A RUN MAKES. Anonymous wizard customers, `pg.e2e.*` logins —
 * and the customer-journey drives below, which sign in anonymously and then
 * attach the typed email, so `is_anonymous` flips to false and neither of the
 * first two markers ever saw them again. 540 of them had piled up on C1 by
 * 11 Oct 2026 (e2e-return 311, e2e-scroll 165, ui.refresh.brief 50,
 * e2e-reach-visit 7, ui.cover.brief 2), about 15–35 a day, past 1,000 users.
 *
 * Each pattern is anchored at both ends, requires the 13-digit Date.now()
 * stamp the spec puts in it, and requires @example.com, so it names exactly
 * the address a spec builds — never a seeded login (pg.demo.*, pg.*@gmail),
 * never a fixed fixture address. Written in the regex subset JavaScript and
 * Postgres agree on, so lib/testing/hygiene.test.ts proves the very strings
 * the runner sends. A new spec uses the `pg.e2e.` prefix; it does not add a
 * line here.
 */
export const RUN_EMAIL_PATTERNS = Object.freeze([
  // save-and-return.spec.ts, tom-batch-7sep.spec.ts, reach-and-chat.spec.ts
  "^e2e-(return|scroll|describe|reach-visit|reach-call)-[0-9]{13}@example\\.com$",
  // ui-refresh-baseline.spec.ts (ui.refresh.brief.<width>.<ms>), ui-refresh-coverage.spec.ts
  "^ui\\.(refresh|cover)\\.([a-z0-9]+\\.)*[0-9]{13}@example\\.com$",
]);

/** The same decision `runUserSql` makes, for one user — what the tests prove. */
export function isRunUser({ isAnonymous = false, email = "" } = {}) {
  if (isAnonymous) return true;
  const e = String(email ?? "");
  return e.startsWith("pg.e2e.") || RUN_EMAIL_PATTERNS.some((p) => new RegExp(p).test(e));
}

/**
 * The WHERE fragment over auth.users (`alias` qualifies the columns when the
 * fragment sits inside a query that has its own `email`). The patterns are
 * constants with no quotes in them; quoting is belt and braces.
 */
export function runUserSql(alias = "") {
  const lit = (s) => `'${s.replace(/'/g, "''")}'`;
  const c = (col) => (alias ? `${alias}.${col}` : col);
  return `(${c("is_anonymous")} or ${c("email")} like 'pg.e2e.%' or ${c("email")} ~ any(array[${RUN_EMAIL_PATTERNS.map(lit).join(", ")}]::text[]))`;
}

/**
 * WHICH ACCOUNTS A RUN MAKES. `@example.com` alone is not a marker: the
 * seeded trade demo (scripts/portal/seed-trade-demo.mjs) is four ORG accounts
 * at pg.demo.*@example.com, and on 11 Oct 2026 three of them — facilities,
 * insurer, volume with its 40 properties — had been swept, their logins left
 * standing with nothing to log in to; agency survived only because a
 * RESTRICT child refused. So an account is a run's only when its email is
 * @example.com, it is not pg.demo.*, AND every person who belongs to it is a
 * run user — an account any seeded or real login belongs to is never ours.
 * A fragment over `public.accounts a`.
 */
export function exampleAccountSql() {
  return `(a.email like '%@example.com' and a.email not like 'pg.demo.%'` +
    ` and not exists (select 1 from public.account_users au join auth.users u on u.id = au.profile_id` +
    ` where au.account_id = a.id and not ${runUserSql("u")}))`;
}

/**
 * WHICH JOBS A RUN'S SERVICE-ROLE FIXTURE MAKES (21 Oct 2026). The work-order
 * specs build their job through `createLoopFixture` (e2e/fixtures/woLoop.ts)
 * with the service client — no user marker reaches it, so a cancelled run
 * leaves the job behind for ever. By 21 Oct the shared e2e painter carried 76
 * such jobs stuck at in_progress (6–11 Sep) and 5 closed, and the closed ones
 * had quietly moved the painter past "new" (qaCadence.newContractorJobs), so
 * every spec that expected a check on finish went red.
 *
 * A fixture job is named by BOTH marks the fixture writes — the ref prefix
 * `WO-E2E` and the snapshot title `E2E tick fixture` — never by one alone: a
 * real ref is `WO-` + eight hex characters of the share token, so `WO-E2E…`
 * is possible by chance, and the schedule specs write their own `WO-E2E*`
 * refs with other snapshots. Age-gated at `fixtureJobAgeDays` on `issued_at`
 * (the fixture stamps it at creation), so a running suite's job — minutes old
 * — is never selected. A fragment over `public.work_orders w`.
 */
export const FIXTURE_JOB_REF_PREFIX = "WO-E2E";
export const FIXTURE_JOB_TITLE = "E2E tick fixture";

export function fixtureJobSql(alias = "w") {
  const c = (col) => (alias ? `${alias}.${col}` : col);
  return `(${c("wo_ref")} like '${FIXTURE_JOB_REF_PREFIX}%' and ${c("wo_snapshot")}->>'jobTitle' = '${FIXTURE_JOB_TITLE}'` +
    ` and ${c("estimate_id")} is not null and ${c("issued_at")} < now() - ($1::int * interval '1 day'))`;
}

/**
 * WHICH VISIT REQUESTS A RUN LEAVES BEHIND (23 Oct 2026). `visit_requests`
 * has no foreign key to the estimate or the user that made it, so the user
 * walk never reaches one: when a cancelled run's anonymous customer is swept,
 * their request stays, open, for ever — and on Today as "Offer a visit time —
 * Visit sorrento", which is the title the live spec then asserted away. The
 * mark is the customer's `@example.com` address (never a real customer's,
 * never the seeded pg.demo.* orgs) with no estimate left to belong to, older
 * than the age gate. A fragment over `public.visit_requests r`, `$1` = days.
 */
export function orphanVisitRequestSql(alias = "r") {
  const c = (col) => (alias ? `${alias}.${col}` : col);
  return `(${c("email")} like '%@example.com' and ${c("email")} not like 'pg.demo.%'` +
    ` and (${c("estimate_id")} is null or not exists (select 1 from public.estimates e where e.id = ${c("estimate_id")}))` +
    ` and ${c("created_at")} < now() - ($1::int * interval '1 day'))`;
}

/** The same decision, for one row — what the tests prove.
 * @param {{ woRef?: string | null, jobTitle?: string | null, estimateId?: string | null, issuedAt?: string | null, now?: number, days?: number }} [row] */
export function isFixtureJob({ woRef = "", jobTitle = "", estimateId = null, issuedAt = null, now = Date.now(), days = DEFAULTS.fixtureJobAgeDays } = {}) {
  if (!String(woRef ?? "").startsWith(FIXTURE_JOB_REF_PREFIX)) return false;
  if (jobTitle !== FIXTURE_JOB_TITLE) return false;
  if (!estimateId) return false;
  const issued = issuedAt ? new Date(issuedAt).getTime() : NaN;
  if (!Number.isFinite(issued)) return false;
  return issued < now - days * 86_400_000;
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
  // 20270210: a contact mirrored from an account is the account's — SET NULL
  // would leave an orphan Contacts row per e2e customer, for ever.
  "public.contacts.account_id",
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
  const key = `${fk.child}.${fk.column}`;
  if ((rule === "SET NULL" || rule === "SET DEFAULT") && owned.includes(key)) return "purge";
  if (rule === "SET NULL" || rule === "SET DEFAULT") return "leave";
  if (rule === "RESTRICT") return "purge";
  if (owned.includes(key) || fk.nullable === false) return "purge";
  return "nullify";
}

/**
 * The tripwire verdict. The line is produced whatever the numbers are —
 * ⚑44: a tripwire that says nothing until it fails is one nobody reads.
 * The threshold is on USERS, because users are what the delete walk is bounded
 * by. But users are not what fills the project: on 19 Sep 2026, 8,711 of them
 * carried 66,168 estimates, 31,654 properties and 27,225 accounts — so the one
 * number this line used to print understated the load about eightfold. The
 * hangers-on are now reported beside it, clearly outside the threshold, so the
 * next person does not have to go and query for them.
 *
 * @param {{ anonymous?: number, e2eLogins?: number, estimates?: number, accounts?: number } | null | undefined} counts
 * @param {{ warnRows: number, failRows: number }} [thresholds]
 * @returns {{ level: "ok" | "warn" | "fail", total: number, line: string }}
 */
export function verdict(counts, thresholds = DEFAULTS) {
  const anonymous = Number(counts?.anonymous) || 0;
  const e2eLogins = Number(counts?.e2eLogins) || 0;
  const total = anonymous + e2eLogins;
  const hangers = [
    ["estimates", counts?.estimates],
    ["accounts", counts?.accounts],
  ].filter(([, n]) => Number.isFinite(Number(n)))
    .map(([k, n]) => `${k} ${Number(n).toLocaleString("en-AU")}`);
  const carried = hangers.length ? ` · carrying ${hangers.join(", ")}` : "";
  const line = `test-project rows · anonymous users ${anonymous.toLocaleString("en-AU")} · e2e logins ${e2eLogins.toLocaleString("en-AU")} · total ${total.toLocaleString("en-AU")} (warn ${thresholds.warnRows.toLocaleString("en-AU")} · fail ${thresholds.failRows.toLocaleString("en-AU")})${carried}`;
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
