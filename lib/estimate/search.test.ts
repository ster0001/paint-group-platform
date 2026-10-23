import { describe, expect, it } from "vitest";
import { filterEstimateRows, filterWaitingItems, filterWizardSessions, matchesNeedle } from "./search";

const row = (o: Partial<{ title: string | null; customer: string | null; address: string | null; number: number | null; wizard: { name: string | null; address: string | null; suburb: string | null } | null }>) => ({
  title: null, customer: null, address: null, number: null, wizard: null, ...o,
}) as Parameters<typeof filterEstimateRows>[0][number];

describe("matchesNeedle", () => {
  it("an empty or blank needle matches everything", () => {
    expect(matchesNeedle("", null)).toBe(true);
    expect(matchesNeedle("   ", "x")).toBe(true);
  });
  it("is a case-insensitive substring over any field, trimming the needle", () => {
    expect(matchesNeedle(" BEEBLE ", "Zaphod Beeblebrox")).toBe(true);
    expect(matchesNeedle("probe", null, undefined, "99 Probe Lane")).toBe(true);
    expect(matchesNeedle("nobody", "Zaphod", "99 Probe Lane")).toBe(false);
  });
});

describe("filterEstimateRows", () => {
  const rows = [
    row({ title: "Probe Lane", customer: "Zaphod Beeblebrox", address: "99 Probe Lane, Northcote", number: 42 }),
    row({ title: "Kitchen", customer: "Arthur Dent", number: 7, wizard: { name: "Arthur", address: "1 Cottage Row", suburb: "Islington" } }),
  ];
  it("returns every row for an empty needle (a fresh array)", () => {
    const out = filterEstimateRows(rows, "");
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
  it("matches customer, address and the wizard session's fields", () => {
    expect(filterEstimateRows(rows, "beeble").map((r) => r.number)).toEqual([42]);
    expect(filterEstimateRows(rows, "northcote").map((r) => r.number)).toEqual([42]);
    expect(filterEstimateRows(rows, "islington").map((r) => r.number)).toEqual([7]);
    expect(filterEstimateRows(rows, "cottage").map((r) => r.number)).toEqual([7]);
  });
  it("finds an estimate by number as 42, 0042 or #42, and not by a partial", () => {
    for (const q of ["42", "0042", "#42"]) expect(filterEstimateRows(rows, q).map((r) => r.number)).toEqual([42]);
    expect(filterEstimateRows(rows, "4")).toEqual([]);
  });
  it("a stranger needle matches nothing", () => {
    expect(filterEstimateRows(rows, "zzz-no-such-customer")).toEqual([]);
  });
});

describe("filterWizardSessions / filterWaitingItems", () => {
  it("wizard sessions match name, address, suburb, email or phone", () => {
    const s = [{ name: "Trillian", address: null, suburb: "Fitzroy", email: "t@example.com", phone: "0400 000 000" }];
    expect(filterWizardSessions(s, "fitz")).toHaveLength(1);
    expect(filterWizardSessions(s, "t@example")).toHaveLength(1);
    expect(filterWizardSessions(s, "0400 000")).toHaveLength(1);
    expect(filterWizardSessions(s, "marvin")).toHaveLength(0);
    expect(filterWizardSessions(s, "")).toEqual(s);
  });
  it("waiting items match title or detail", () => {
    const i = [{ title: "Confirm 12 Probe Lane", detail: "Zaphod asked a question" }];
    expect(filterWaitingItems(i, "zaphod")).toHaveLength(1);
    expect(filterWaitingItems(i, "probe")).toHaveLength(1);
    expect(filterWaitingItems(i, "dent")).toHaveLength(0);
  });
});
