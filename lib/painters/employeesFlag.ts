/**
 * The employed-painters switch (brief §5 rule 4). One settings row,
 * `employees_enabled`, seeded off by migration 20270153.
 *
 * What it gates: the office's ability to mark a painter as an employee
 * (the tick box on /contractors, Session 5). What it does NOT gate: how an
 * existing employee row is treated — lib/painters/capabilities.ts reads the
 * row, not this switch, so turning it off can never make money visible to
 * someone it was hidden from.
 *
 * Same shape as lib/wizard/publicFlag.ts: the settings value → a complete
 * object, anything unusable falls back to OFF.
 */

export const EMPLOYEES_ENABLED_KEY = "employees_enabled";

export type EmployeesSwitch = { enabled: boolean };

export const DEFAULT_EMPLOYEES_SWITCH: EmployeesSwitch = { enabled: false };

export function employeesSwitchFrom(value: unknown): EmployeesSwitch {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { enabled: v.enabled === true };
}
