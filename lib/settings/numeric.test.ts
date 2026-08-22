import { describe, expect, it } from "vitest";
import {
  isNumericSetting, numericSettingValue, settingNotes, settingUnit, withNumber,
} from "./numeric";

describe("which settings rows are numbers", () => {
  it("reads the lever envelope the pricing rows are stored in", () => {
    expect(numericSettingValue({ unit: "$ / week", notes: "Your figure", value: 1200 })).toBe(1200);
  });

  it("reads a bare number", () => {
    expect(numericSettingValue(0.1)).toBe(0.1);
  });

  it("reads a number that was stored as a string", () => {
    expect(numericSettingValue({ value: "1741" })).toBe(1741);
  });

  // The bug: these were being coerced with Number(), which gives NaN, which
  // serialises to JSON null, which the NOT NULL column refuses — taking every
  // other row in the same upsert down with it.
  it.each([
    ["wizard_policy", { minAccuracyPctToAccept: 80, smallJobMinAccuracyPct: 90 }],
    ["wo_loop", { rubbish: { costedToJob: true } }],
    ["service_area", { postcodes: [] }],
    ["wizard_public", { enabled: true }],
    ["estimate_templates", []],
    ["terms_conditions", "Terms\n\nWe agree to provide…"],
    ["an empty value", { value: "" }],
    ["nothing at all", null],
  ])("refuses %s", (_name, value) => {
    expect(numericSettingValue(value)).toBeNull();
    expect(isNumericSetting(value)).toBe(false);
  });
});

describe("writing a number back", () => {
  it("keeps the unit and notes rather than flattening the row to a number", () => {
    const original = { unit: "$ / week", notes: "Your figure", value: 1200 };
    expect(withNumber(original, 1741)).toEqual({ unit: "$ / week", notes: "Your figure", value: 1741 });
  });

  it("leaves a bare number bare", () => {
    expect(withNumber(0.1, 0.15)).toBe(0.15);
  });

  it("refuses NaN, so nothing can send null at a NOT NULL column", () => {
    expect(withNumber({ value: 1 }, Number.NaN)).toBeNull();
    expect(withNumber(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("hands the unit and notes to the screen", () => {
    const row = { unit: "$ / hour", notes: "Calculated", value: 10.83 };
    expect(settingUnit(row)).toBe("$ / hour");
    expect(settingNotes(row)).toBe("Calculated");
    expect(settingUnit(4)).toBe("");
  });
});
