/**
 * Contract tests over A2 — invoicing batch 1.
 *
 * The invoice is a financial document and has to stand on its own. Two
 * things make that true, and both are easy to undo by accident:
 *
 *  - every insert names `customer_id` and reads it from the parent estimate;
 *  - `invoices.estimate_id` is ON DELETE RESTRICT, so a delete that skips
 *    `delete_estimate` is refused by the database rather than silently
 *    orphaning the row.
 *
 * These assert on the migration text, the same way `lib/workorder/
 * signoff.test.ts` does — they run in `npm test` with no database, so a
 * regression is caught on every commit rather than only when someone
 * remembers to run Playwright against live.
 *
 * The live proof that an insert actually COPIES the value is
 * `e2e/invoice-customer-inherit.spec.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(process.cwd(), "supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const A2 = read("20261026000000_invoices_customer_link.sql");

/** Every migration that inserts into `invoices`, oldest first. */
const insertingMigrations = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => read(f).includes("insert into public.invoices"));

describe("every invoice carries its own customer", () => {
  it("accept_estimate copies customer_id from the estimate it accepted", () => {
    expect(A2).toMatch(
      /insert into public\.invoices \(estimate_id, customer_id, status, amount_cents, issued_on\)\s*\n\s*values \(v_id,\s*\n\s*\(select customer_id from public\.estimates where id = v_id\)/,
    );
  });

  it("wo_sign copies it onto the sign-off stub too", () => {
    expect(A2).toMatch(
      /insert into public\.invoices \(estimate_id, customer_id, status, amount_cents, issued_on\)\s*\n\s*values \(v_wo\.estimate_id,\s*\n\s*\(select customer_id from public\.estimates where id = v_wo\.estimate_id\)/,
    );
  });

  it("the NEWEST word on the insert sites still names customer_id", () => {
    // Earlier files insert without customer_id — superseded `create or
    // replace` bodies. Whatever migration sorts LAST and redefines an insert
    // site must carry the column, or A2 is silently undone. (Originally this
    // pinned A2's filename; 20261028 legitimately replaced wo_sign — the
    // invariant is the column, not the filename.)
    const newest = read(insertingMigrations.at(-1)!);
    const inserts = newest.match(/^\s*insert into public\.invoices \([^)]*\)/gm) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    for (const i of inserts) expect(i).toContain("customer_id");
    expect(insertingMigrations.length).toBeGreaterThanOrEqual(5);
  });

  it("leaves no insert in A2 that forgets the column", () => {
    // Line-anchored: the readback SELECT also contains the phrase, inside a
    // LIKE pattern, and that is a match on the column name rather than an insert.
    const inserts = A2.match(/^\s*insert into public\.invoices \([^)]*\)/gm) ?? [];
    expect(inserts.length).toBe(2);
    for (const i of inserts) expect(i).toContain("customer_id");
  });
});

describe("the FK agrees with the delete guard", () => {
  it("estimate_id is ON DELETE RESTRICT, not SET NULL", () => {
    expect(A2).toMatch(
      /add constraint invoices_estimate_id_fkey\s*\n\s*foreign key \(estimate_id\) references public\.estimates \(id\) on delete restrict/,
    );
    expect(A2).not.toMatch(/invoices_estimate_id_fkey[\s\S]{0,200}on delete set null/);
  });

  it("still refuses through the RPC — the app guard is not replaced by the FK", () => {
    const guard = read("20260911000000_delete_estimate.sql");
    expect(guard).toContain("return 'error:has_invoice'");
  });
});

describe("what A2 deliberately does NOT do", () => {
  it("does not add NOT NULL — it would throw on every future acceptance", () => {
    // 70 of 71 estimates have a null customer, so the value this inserts is
    // null today. The constraint belongs with the identity-link work.
    expect(A2).not.toMatch(/alter column customer_id set not null/i);
  });

  it("does not delete data — the orphan sweep is a separate, guarded paste", () => {
    expect(A2).not.toMatch(/delete\s+from\s+public\.invoices/i);
  });

  it("ends with a readback, per the migrations-are-not-assumed rule", () => {
    expect(A2).toContain("information_schema.referential_constraints");
    expect(A2).toContain("names_customer_id");
  });
});

describe("the orphan sweep cannot run on stale counts", () => {
  const SWEEP = readFileSync(resolve(process.cwd(), "supabase/fixes/a2-invoice-orphans.sql"), "utf8");

  it("aborts unless the table still reads exactly 34 / 0 / 3 / 37", () => {
    expect(SWEEP).toContain("is distinct from (34, 0, 3, 37)");
    expect(SWEEP).toMatch(/raise exception\s*\n?\s*'A2 ABORT/);
  });

  it("keeps the amount_cents = 0 guard that protects the live deposits", () => {
    expect(SWEEP).toMatch(/delete from public\.invoices\s*\n\s*where estimate_id is null\s*\n\s*and amount_cents = 0;/);
  });

  it("re-verifies inside the same transaction as the delete", () => {
    const begin = SWEEP.indexOf("begin;");
    const check = SWEEP.indexOf("is distinct from (34, 0, 3, 37)");
    const del = SWEEP.indexOf("delete from public.invoices");
    const commit = SWEEP.indexOf("commit;");
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(check);
    expect(check).toBeLessThan(del);
    expect(del).toBeLessThan(commit);
  });
});
