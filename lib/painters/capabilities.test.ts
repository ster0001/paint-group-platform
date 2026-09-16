import { describe, expect, it } from "vitest";
import {
  EMPLOYMENT_TYPES, employmentTypeOf, isEmploymentType, painterCapabilities, type PainterCapabilities,
} from "./capabilities";

/**
 * The capability matrix from the brief (§3.1), pinned. Every session in the
 * employed-painters build tests against this table; a change here is a
 * change to the brief, not a refactor.
 */
const MATRIX: Record<"contractor" | "employee", PainterCapabilities> = {
  contractor: {
    acceptsOffers: true, acknowledgesAssignments: false, seesMoney: true, seesTimeBudget: true,
    canSelfInvoice: true, canClaimExpenses: true, requiresInsurance: true, hasCrewCount: true,
    multiAssignable: false, clocksOn: false,
  },
  employee: {
    acceptsOffers: false, acknowledgesAssignments: true, seesMoney: false, seesTimeBudget: true,
    canSelfInvoice: false, canClaimExpenses: true, requiresInsurance: false, hasCrewCount: false,
    multiAssignable: true, clocksOn: true,
  },
};

describe("painterCapabilities — the one capability function", () => {
  it("matches the brief's matrix for both employment types", () => {
    expect(painterCapabilities("contractor")).toEqual(MATRIX.contractor);
    expect(painterCapabilities("employee")).toEqual(MATRIX.employee);
    expect(painterCapabilities({ employment_type: "employee" })).toEqual(MATRIX.employee);
    expect(painterCapabilities({ employment_type: "contractor" })).toEqual(MATRIX.contractor);
  });

  it("an employee never sees money, never self-invoices, never receives offers", () => {
    const e = painterCapabilities("employee");
    expect(e.seesMoney).toBe(false);
    expect(e.canSelfInvoice).toBe(false);
    expect(e.acceptsOffers).toBe(false);
  });

  it("anything that is not the literal 'employee' is a contractor — the proven type", () => {
    for (const v of [null, undefined, {}, { employment_type: null }, { employment_type: "EMPLOYEE" },
                     { employment_type: "staff" }, { employment_type: 1 }]) {
      expect(painterCapabilities(v as never)).toEqual(MATRIX.contractor);
    }
  });

  it("the two sets are frozen — nobody patches a capability at a call site", () => {
    const c = painterCapabilities("contractor");
    expect(Object.isFrozen(c)).toBe(true);
    expect(() => { (c as { seesMoney: boolean }).seesMoney = false; }).toThrow();
  });

  it("employmentTypeOf round-trips", () => {
    expect(employmentTypeOf("employee")).toBe("employee");
    expect(employmentTypeOf({ employment_type: "contractor" })).toBe("contractor");
    expect(employmentTypeOf(null)).toBe("contractor");
  });

  it("isEmploymentType narrows exactly the two values", () => {
    expect(EMPLOYMENT_TYPES).toEqual(["contractor", "employee"]);
    expect(isEmploymentType("employee")).toBe(true);
    expect(isEmploymentType("contractor")).toBe(true);
    expect(isEmploymentType("Employee")).toBe(false);
    expect(isEmploymentType(undefined)).toBe(false);
  });
});
