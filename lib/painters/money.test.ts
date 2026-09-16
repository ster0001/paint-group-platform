import { describe, expect, it } from "vitest";
import { KNOWN_MONEY_KEYS, MONEY_KEY_RE, findMoneyKeys, isMoneyFree } from "./money";

describe("the money vocabulary (brief §3.3)", () => {
  it("catches every concrete money key this codebase gives painters", () => {
    for (const k of KNOWN_MONEY_KEYS) expect(k, `${k} should be money-shaped`).toMatch(MONEY_KEY_RE);
  });

  it("does not catch the keys an employee payload legitimately carries", () => {
    for (const k of [
      "id", "work_order_id", "wo_ref", "jobTitle", "jobAddress", "stage", "start_date", "end_date",
      "time_budget", "days", "hours", "est_hours", "is_lead", "accepted_at", "surfaces", "coats",
      "product", "colourName", "levelOfFinish", "contactFirstName", "contactPhone", "materials",
      "litres", "photos", "status", "category", "comment", "hours_allowance", "operator", "accurate",
      "separate", "generated", "moderate", "decorate", "corporate",
    ]) {
      expect(k, `${k} should NOT be money-shaped`).not.toMatch(MONEY_KEY_RE);
    }
  });

  it("walks arrays and nested objects and names the path", () => {
    const tree = {
      id: "x",
      jobs: [
        { id: "a", time_budget: { days: 2, hours: 15 } },
        { id: "b", wo_snapshot: { areas: [{ surfaces: [{ hours: 1, contractorPaymentCents: 0 }] }] } },
      ],
      offer: null,
    };
    expect(findMoneyKeys(tree)).toEqual([
      "jobs[1].wo_snapshot.areas[0].surfaces[0].contractorPaymentCents",
      "offer",
    ]);
    expect(isMoneyFree(tree)).toBe(false);
  });

  it("a zeroed or nulled money key is still a leak — absence is the contract", () => {
    expect(findMoneyKeys({ payment_cents: 0 })).toEqual(["payment_cents"]);
    expect(findMoneyKeys({ payment_cents: null })).toEqual(["payment_cents"]);
  });

  it("scalars and empty trees are money-free", () => {
    for (const v of [null, undefined, 1, "price", [], {}, [{}]]) expect(isMoneyFree(v)).toBe(true);
  });
});
