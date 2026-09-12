import type { SupabaseClient } from "@supabase/supabase-js";
import { estimatorForPostcode } from "./confirmation";
import { settingValue } from "./policy";

/**
 * C11 — WHO the customer's estimator is, resolved ONCE and read by every
 * surface that names a person: the reveal strip, the tighten screen, the
 * finish line, the CTA ("Send to <name>") and the hand-off page.
 *
 * The record is the staff profile whose patch covers the postcode
 * (C5's `profiles.patch_postcodes`), falling back to the coordinator in
 * Settings — the same two sources `customer-scope.ts` used for `sendTo`, now
 * in one place. `covers` says whether a real patch matched: only then may a
 * screen claim the suburb. It REFUSES to invent a name: no record, no name,
 * and the caller says "we".
 */
export type Estimator = {
  id: string | null;
  name: string | null;
  phone: string | null;
  /** True when a staff patch matched the postcode (not the Settings fallback). */
  covers: boolean;
};

export const NO_ESTIMATOR: Estimator = { id: null, name: null, phone: null, covers: false };

export async function resolveEstimator(
  db: SupabaseClient,
  settings: Array<{ key: string; value: unknown }>,
  postcode: string | null | undefined,
): Promise<Estimator> {
  if (postcode) {
    const { data: staffRows } = await db.from("profiles")
      .select("id, name, phone, patch_postcodes").not("patch_postcodes", "is", null);
    const rows = ((staffRows ?? []) as Array<{ id: string; name: string | null; phone: string | null; patch_postcodes: string[] | null }>);
    const id = estimatorForPostcode(postcode, rows.map((r) => ({ id: r.id, postcodes: r.patch_postcodes ?? [] })));
    const row = id ? rows.find((r) => r.id === id) : null;
    if (row?.name?.trim()) return { id: row.id, name: row.name.trim(), phone: row.phone?.trim() || null, covers: true };
  }
  const profile = (settingValue(settings, "company_profile") ?? {}) as { coordinatorName?: string; phone?: string };
  const name = profile.coordinatorName?.trim() || null;
  return name ? { id: null, name, phone: profile.phone?.trim() || null, covers: false } : NO_ESTIMATOR;
}

export function initialsOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
