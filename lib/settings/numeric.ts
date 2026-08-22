/**
 * Which settings rows are NUMBERS, and how to write one back without losing
 * what surrounds it.
 *
 * `settings.value` is jsonb and holds two quite different things: the pricing
 * levers, stored as `{ unit, notes, value }` (or occasionally a bare number),
 * and whole configuration objects — `wizard_policy`, `wo_loop`, `service_area`.
 * The Pricing & job numbers folder took EVERY row that wasn't one of six named
 * keys, coerced it with `Number()`, and got `NaN` for each config object.
 * `NaN` serialises to JSON `null`, the column is NOT NULL, and one bad value
 * fails the whole upsert — which is why no pricing setting could be saved at
 * all. Worse, had it succeeded it would have replaced those config objects with
 * a number and the unit/notes on every lever with nothing.
 *
 * So: decide by SHAPE, not by a list of keys to exclude. A key added tomorrow
 * is handled correctly without anyone remembering this file exists.
 */

/** The `{ unit, notes, value }` wrapper the pricing levers are stored in. */
export type SettingEnvelope = { value: number; unit?: string; notes?: string };

/** The number inside a settings value, or null when the row isn't a number. */
export function numericSettingValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw && typeof raw === "object" && "value" in raw) {
    const inner = (raw as { value: unknown }).value;
    if (typeof inner === "number") return Number.isFinite(inner) ? inner : null;
    // A number stored as a string still counts — but "" and "abc" do not.
    if (typeof inner === "string" && inner.trim() !== "") {
      const n = Number(inner);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** True when this row belongs in the numeric pricing folder. */
export function isNumericSetting(raw: unknown): boolean {
  return numericSettingValue(raw) !== null;
}

export const settingUnit = (raw: unknown): string =>
  raw && typeof raw === "object" && typeof (raw as { unit?: unknown }).unit === "string"
    ? (raw as { unit: string }).unit : "";

export const settingNotes = (raw: unknown): string =>
  raw && typeof raw === "object" && typeof (raw as { notes?: unknown }).notes === "string"
    ? (raw as { notes: string }).notes : "";

/**
 * The value to write back: the ORIGINAL shape with only the number replaced.
 * A lever keeps its unit and notes; a row stored as a bare number stays one.
 * Returns null for a value that isn't a real number, so the caller can refuse
 * to save rather than sending JSON `null` at a NOT NULL column.
 */
export function withNumber(original: unknown, next: number): SettingEnvelope | number | null {
  if (!Number.isFinite(next)) return null;
  if (original && typeof original === "object" && !Array.isArray(original)) {
    return { ...(original as Record<string, unknown>), value: next } as SettingEnvelope;
  }
  return next;
}
