import { describe, expect, it } from "vitest";
import { bypassesWizardLimits } from "./limits";

describe("bypassesWizardLimits — §3's gates", () => {
  it("trade accounts are never limited (decided)", () => {
    expect(bypassesWizardLimits({ account_type: "trade", flags: {} })).toBe(true);
  });
  it("residential accounts keep the standard limits", () => {
    expect(bypassesWizardLimits({ account_type: "residential", flags: {} })).toBe(false);
    expect(bypassesWizardLimits({ account_type: "residential", flags: null })).toBe(false);
  });
  it("the office unblock lifts one account without making it trade", () => {
    expect(bypassesWizardLimits({ account_type: "residential", flags: { unlimited: true } })).toBe(true);
    expect(bypassesWizardLimits({ account_type: "residential", flags: { unlimited: "yes" } })).toBe(false);
  });
  it("no account, no bypass", () => {
    expect(bypassesWizardLimits(null)).toBe(false);
  });
});
