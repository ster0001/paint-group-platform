import { describe, expect, it } from "vitest";
import { buildLeadSnapshot, leadMoney, parseLeadSnapshot } from "./leadSnapshot";

const now = new Date("2026-11-12T01:00:00Z");
const base = { rangeLoCents: 640_000, rangeHiCents: 790_000, jobType: "interior", contactName: "  Amanda Jane Hughes ", address: "12 Acacia Street, Northcote VIC 3070", biggerJob: false, now };

describe("the lead page snapshot (A‑F)", () => {
  it("keeps the range, the first name only, the address and when it was priced", () => {
    const s = buildLeadSnapshot(base)!;
    expect(s).toMatchObject({ version: 1, kind: "lead", rangeLoCents: 640_000, rangeHiCents: 790_000, firstName: "Amanda", jobType: "interior", biggerJob: false, parts: null, pricedAt: "2026-11-12T01:00:00.000Z" });
    expect(JSON.stringify(s)).not.toContain("Hughes");
    expect(parseLeadSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("keeps a both job's two halves", () => {
    const s = buildLeadSnapshot({ ...base, jobType: "both", parts: { interior: { rangeLoCents: 400_000, rangeHiCents: 500_000 }, exterior: { rangeLoCents: 240_000, rangeHiCents: 290_000 } } })!;
    expect(s.parts?.exterior).toEqual({ rangeLoCents: 240_000, rangeHiCents: 290_000 });
  });
  it("keeps nothing when there is no range, and refuses a high below the low", () => {
    expect(buildLeadSnapshot({ ...base, rangeHiCents: 0 })).toBeNull();
    expect(buildLeadSnapshot({ ...base, rangeLoCents: Number.NaN })).toBeNull();
    expect(buildLeadSnapshot({ ...base, rangeLoCents: 900_000 })).toBeNull();
  });
  it("an unknown job type is kept as unknown, not guessed", () => {
    expect(buildLeadSnapshot({ ...base, jobType: "roof" })!.jobType).toBeNull();
  });
  it("the page refuses anything that is not a version-1 lead snapshot", () => {
    expect(parseLeadSnapshot(null)).toBeNull();
    expect(parseLeadSnapshot({ version: 1, kind: "estimate" })).toBeNull();
    expect(parseLeadSnapshot({ ...buildLeadSnapshot(base), version: 2 })).toBeNull();
  });
  it("prints whole dollars like the gate", () => {
    expect(leadMoney(640_049)).toBe("$6,400");
  });
});
