/**
 * The dashboard's period follows the login around (Tom, 20 Sep 2026: "this
 * needs to be done across all dashboards"). One cookie, `dash_range`, holds
 * the last choice — `week`, `month|2026-08-03|2026-08-10`… — and /home
 * reads it whenever the URL names no period, so the owner's Quarter is
 * still Quarter after a drill, a role switch or tomorrow's sign-in. A
 * preference, not a fact: server-safe, no secret, never trusted beyond
 * `parsePreset` and the day-shape check.
 */
import { parsePreset, type RangePreset } from "./core";

export const RANGE_COOKIE = "dash_range";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type RememberedRange = { preset: RangePreset; from?: string; to?: string };

export function rangeCookieValue(preset: RangePreset, from: string, to: string): string {
  return preset === "custom" ? `custom|${from}|${to}` : preset;
}

export function parseRangeCookie(value: string | null | undefined): RememberedRange | null {
  if (!value) return null;
  const [raw, from, to] = value.split("|");
  const preset = parsePreset(raw);
  if (!preset) return null;
  if (preset !== "custom") return { preset };
  return from && to && DAY.test(from) && DAY.test(to) ? { preset, from, to } : null;
}
