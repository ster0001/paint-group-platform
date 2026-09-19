import { describe, expect, it } from "vitest";
import { contextFromRows } from "./context";

const trade = { source: "manual", account_id: "a1", property_id: "p1", accounts: { name: "Sample Property Group", account_type: "trade" } };
const residential = { source: "manual", account_id: "a2", property_id: null, accounts: { name: "Ben Guptill", account_type: "residential" } };
const website = { painters: [{ name: "Jacob", photoPath: "site/jacob.jpg" }, { name: "Mia", photoPath: null }], demoPainter: "Jacob" };

describe("contextFromRows (brief §4, F1, F5)", () => {
  it("trade account → commercial, with the organisation and references", () => {
    const c = contextFromRows(trade, [{ label: "PO", value: "4471" }], website);
    expect(c.set).toBe("commercial");
    expect(c.organisationName).toBe("Sample Property Group");
    expect(c.references).toEqual([{ label: "PO", value: "4471" }]);
  });
  it("residential account → residential", () => {
    expect(contextFromRows(residential, null, website).set).toBe("residential");
  });
  it("no account → residential, no organisation", () => {
    const c = contextFromRows({ source: "manual", account_id: null, property_id: null, accounts: null }, null, website);
    expect(c.set).toBe("residential");
    expect(c.organisationName).toBeNull();
    expect(contextFromRows(null, null, null).set).toBe("residential");
  });
  it("demo painter: set with a photo → name + public URL; unset or photo-less → null", () => {
    expect(contextFromRows(null, null, website).demoPainter).toEqual({ name: "Jacob", photoUrl: expect.stringMatching(/showcase-media\/site\/jacob\.jpg$/) });
    expect(contextFromRows(null, null, { ...website, demoPainter: "Mia" }).demoPainter).toBeNull();
    expect(contextFromRows(null, null, { ...website, demoPainter: null }).demoPainter).toBeNull();
    expect(contextFromRows(null, null, { ...website, demoPainter: "Nobody" }).demoPainter).toBeNull();
    expect(contextFromRows(null, null, null).demoPainter).toBeNull();
  });
  it("F9: a wizard self-built estimate is not eligible; a missing row is not eligible", () => {
    expect(contextFromRows({ ...trade, source: "wizard" }, null, null).eligible).toBe(false);
    expect(contextFromRows(trade, null, null).eligible).toBe(true);
    expect(contextFromRows(null, null, null).eligible).toBe(false);
  });
  it("empty references become null", () => {
    expect(contextFromRows(trade, [], null).references).toBeNull();
  });
});
