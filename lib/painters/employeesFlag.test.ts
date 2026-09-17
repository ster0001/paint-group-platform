import { describe, expect, it } from "vitest";
import { DEFAULT_EMPLOYEES_SWITCH, EMPLOYEES_ENABLED_KEY, employeesSwitchFrom } from "./employeesFlag";

describe("employees_enabled switch", () => {
  it("is off by default and off for anything unusable", () => {
    expect(DEFAULT_EMPLOYEES_SWITCH).toEqual({ enabled: false });
    for (const v of [null, undefined, "", 0, "true", [], {}, { enabled: "true" }, { enabled: 1 }]) {
      expect(employeesSwitchFrom(v)).toEqual({ enabled: false });
    }
  });

  it("is on only for the literal true", () => {
    expect(employeesSwitchFrom({ enabled: true })).toEqual({ enabled: true });
  });

  it("reads the settings row migration 20270153 seeds", () => {
    expect(EMPLOYEES_ENABLED_KEY).toBe("employees_enabled");
  });
});
