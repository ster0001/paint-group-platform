import { describe, expect, it } from "vitest";
// The rules are plain ESM so the runner (a script, not part of the Next
// build) and this suite read the SAME file.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — an .mjs module with no declarations
import { checkTarget, DEFAULTS, fkAction, OWNED, parseArgs, projectRefOf, seededExclusion, summaryLine, verdict } from "../../scripts/c1/hygiene-rules.mjs";

const TEST = "qarfyjrzgdeoqbnbbxfp";
const reasonOf = (r: ReturnType<typeof checkTarget>): string => (r.ok ? "" : r.reason);
const PROD = "llmrvgdequpmzzuaxdhq";

describe("C7c — the teardown may not run unless the target is provably the test project", () => {
  const db = `postgresql://postgres.${TEST}:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`;
  const site = `https://${TEST}.supabase.co`;
  it("passes only when production is named, the database is nameable, not production, and the app agrees", () => {
    expect(checkTarget({ dbUrl: db, siteUrl: site, productionRef: PROD })).toEqual({ ok: true, ref: TEST });
  });
  it("refuses when production is not named — nothing is inferred", () => {
    expect(checkTarget({ dbUrl: db, siteUrl: site, productionRef: "" }).ok).toBe(false);
    expect(checkTarget({ dbUrl: db, siteUrl: site, productionRef: undefined }).ok).toBe(false);
    expect(checkTarget({ dbUrl: db, siteUrl: site, productionRef: "not-a-ref" }).ok).toBe(false);
  });
  it("refuses production itself, in either form", () => {
    expect(reasonOf(checkTarget({ dbUrl: `postgresql://postgres.${PROD}:pw@host:5432/postgres`, siteUrl: `https://${PROD}.supabase.co`, productionRef: PROD }))).toMatch(/IS the production project/);
    expect(checkTarget({ dbUrl: `postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`, productionRef: PROD }).ok).toBe(false);
  });
  it("refuses a database and an app that are different projects — the 552-drafts accident", () => {
    const r = checkTarget({ dbUrl: db, siteUrl: `https://${PROD}.supabase.co`, productionRef: PROD });
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/different projects/);
  });
  it("refuses a missing or unidentifiable connection string", () => {
    expect(reasonOf(checkTarget({ dbUrl: "", siteUrl: site, productionRef: PROD }))).toMatch(/E2E_DATABASE_URL/);
    expect(reasonOf(checkTarget({ dbUrl: "postgresql://localhost/postgres", siteUrl: site, productionRef: PROD }))).toMatch(/names no project ref/);
  });
  it("reads a ref out of the pooler string, the direct string and the site URL alike", () => {
    expect(projectRefOf(db)).toBe(TEST);
    expect(projectRefOf(`postgresql://postgres:pw@db.${TEST}.supabase.co:5432/postgres`)).toBe(TEST);
    expect(projectRefOf(site)).toBe(TEST);
    expect(projectRefOf("postgresql://localhost/postgres")).toBeNull();
  });
});

describe("the seeded logins are excluded by id, and an empty list refuses", () => {
  it("returns the ids it was given", () => {
    expect(seededExclusion([{ id: "a", email: "pg.sam.staff@gmail.com" }, { id: "b" }])).toEqual(["a", "b"]);
  });
  it("throws rather than delete with nobody protected", () => {
    expect(() => seededExclusion([])).toThrow(/REFUSED/);
    expect(() => seededExclusion([{ id: "" }])).toThrow(/REFUSED/);
    expect(() => seededExclusion(undefined)).toThrow(/REFUSED/);
  });
});

describe("what a foreign key means when its parent goes (brief step 2: the order is not a preference)", () => {
  const fk = (child: string, column: string, rule: string, nullable = true) => ({ child, column, rule, nullable });
  it.each([
    ["CASCADE children are descended, not deleted by us", fk("public.work_orders", "estimate_id", "CASCADE"), "descend"],
    ["SET NULL is Postgres's job", fk("public.wo_photos", "taken_by", "SET NULL"), "leave"],
    ["RESTRICT means the child belongs to the parent", fk("public.invoices", "account_id", "RESTRICT"), "purge"],
    ["NO ACTION on an owned column: the estimate chain goes before the user", fk("public.estimates", "created_by", "NO ACTION"), "purge"],
    ["NO ACTION on an audit column is nulled, not deleted", fk("public.estimates", "site_check_cleared_by", "NO ACTION"), "nullify"],
    ["NO ACTION on a NOT NULL column cannot be nulled, so it is purged", fk("public.contacts", "created_by", "NO ACTION", false), "purge"],
  ])("%s", (_name, f, want) => {
    expect(fkAction(f)).toBe(want);
  });
  it("the six columns the brief names are all handled — five owned, one nulled", () => {
    const six = [
      ["public.estimates", "created_by"], ["public.estimates", "site_check_cleared_by"], ["public.wizard_leads", "user_id"],
      ["public.estimate_sources", "created_by"], ["public.extraction_runs", "created_by"], ["public.defect_observations", "confirmed_by"],
    ];
    const actions = six.map(([child, column]) => fkAction(fk(child, column, "NO ACTION")));
    expect(actions.filter((a) => a === "purge")).toHaveLength(5);
    expect(actions.filter((a) => a === "nullify")).toHaveLength(1);
    expect(OWNED).toHaveLength(5);
  });
});

describe("the tripwire (⚑44): the line is always produced, the thresholds are only the backstop", () => {
  it("logs the counts at zero, and says ok", () => {
    const v = verdict({ anonymous: 0, e2eLogins: 0 });
    expect(v.level).toBe("ok");
    expect(v.line).toBe("test-project rows · anonymous users 0 · pg.e2e.* logins 0 · total 0 (warn 5,000 · fail 20,000)");
  });
  it("warns above 5,000 and fails above 20,000 — the 11 Sep project would have failed", () => {
    expect(verdict({ anonymous: 4_900, e2eLogins: 100 }).level).toBe("ok");
    expect(verdict({ anonymous: 4_900, e2eLogins: 101 }).level).toBe("warn");
    expect(verdict({ anonymous: 10_986, e2eLogins: 257 }).level).toBe("warn"); // the count taken 12 Sep
    expect(verdict({ anonymous: 20_000, e2eLogins: 1 }).level).toBe("fail");
    expect(verdict({ anonymous: 40_000, e2eLogins: 0 }, DEFAULTS).level).toBe("fail");
  });
  it("thresholds are inputs, so seeding past a low one proves the failure path", () => {
    expect(verdict({ anonymous: 3, e2eLogins: 0 }, { warnRows: 1, failRows: 2 }).level).toBe("fail");
  });
});

describe("the summary and the argv", () => {
  it("one line: created, deleted, left, seconds, then the biggest tables", () => {
    expect(summaryLine({ verb: "teardown", created: 12, deleted: 12, left: 0, seconds: 8.25, byTable: { "auth.users": 12, "public.estimates": 9 } }))
      .toBe("teardown: created 12, deleted 12 users, left 0, 8.3s — rows: auth.users 12, estimates 9");
    expect(summaryLine({ verb: "sweep", deleted: 1, left: 3, seconds: 1 })).toBe("sweep: deleted 1 user, left 3, 1.0s");
  });
  it("parses --key value and --flag", () => {
    expect(parseArgs(["sweep", "--age-days", "3", "--json", "--batch", "200"])).toEqual({ _: ["sweep"], "age-days": "3", json: true, batch: "200" });
  });
});
