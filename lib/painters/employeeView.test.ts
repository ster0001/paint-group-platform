import { describe, expect, it } from "vitest";
import { EMPLOYEE_VIEW_SCHEMAS, employeeJobDetailSchema, schemaKeys, timeBudgetSchema } from "./employeeView";
import { MONEY_KEY_RE, findMoneyKeys } from "./money";

/**
 * The employee contract is money-free BY SCHEMA. This is the unit-level half
 * of the brief's golden test (§3.3); e2e/employee-money.spec.ts is the live
 * half. If a session adds `contractor_delta_cents` to the variation card for
 * convenience, this goes red before the code reaches a browser.
 */
describe("view=employee — the money-free contract", () => {
  it("declares no money-shaped key anywhere in any employee schema", () => {
    for (const [name, schema] of Object.entries(EMPLOYEE_VIEW_SCHEMAS)) {
      const keys = schemaKeys(schema);
      expect(keys.length, `${name} should declare keys`).toBeGreaterThan(0);
      const leaks = keys.filter((k) => MONEY_KEY_RE.test(k.split(".").pop()!.replace("[]", "")));
      expect(leaks, `${name} declares money keys`).toEqual([]);
    }
  });

  it("schemaKeys walks nested objects, arrays and nullables", () => {
    const keys = schemaKeys(employeeJobDetailSchema);
    expect(keys).toContain("time_budget.days");
    expect(keys).toContain("areas[].surfaces[].hours");
    expect(keys).toContain("accepted_at");
  });

  it("a conforming payload is money-free and parses; a money key is rejected by strip + walk", () => {
    const budget = timeBudgetSchema.parse({ days: 3, hours: 22.5 });
    expect(findMoneyKeys(budget)).toEqual([]);
    // zod strips unknown keys on parse — the walk over the RAW input is what
    // the e2e does, so a leak upstream of the schema is still a leak.
    const raw = { days: 1, hours: 8, rateCents: 6000 };
    expect(findMoneyKeys(raw)).toEqual(["rateCents"]);
    expect(findMoneyKeys(timeBudgetSchema.parse(raw))).toEqual([]);
  });

  it("time budget refuses negatives — a budget is a size, never a balance", () => {
    expect(timeBudgetSchema.safeParse({ days: -1, hours: 0 }).success).toBe(false);
    expect(timeBudgetSchema.safeParse({ days: 1.5, hours: 0 }).success).toBe(false);
  });
});
