import { describe, expect, it } from "vitest";
import { cardPaymentsEnabledFromSettings } from "./cardPayments";

describe("cardPaymentsEnabledFromSettings", () => {
  it("is OFF unless the switch is exactly true", () => {
    expect(cardPaymentsEnabledFromSettings(null)).toBe(false);
    expect(cardPaymentsEnabledFromSettings(undefined)).toBe(false);
    expect(cardPaymentsEnabledFromSettings({})).toBe(false);
    expect(cardPaymentsEnabledFromSettings({ cardPaymentsEnabled: "true" })).toBe(false);
    expect(cardPaymentsEnabledFromSettings({ cardPaymentsEnabled: 1 })).toBe(false);
    expect(cardPaymentsEnabledFromSettings({ cardPaymentsEnabled: false })).toBe(false);
  });
  it("is ON when the office turned it on", () => {
    expect(cardPaymentsEnabledFromSettings({ cardPaymentsEnabled: true, surchargePctBps: 170 })).toBe(true);
  });
});
