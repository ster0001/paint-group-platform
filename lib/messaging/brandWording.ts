import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingSettings } from "./config";

/**
 * Paint Home's own wording (A‑B, 17 Nov 2026). A row of
 * `automation_brand_wording` (migration 20270316) is the Paint Home text for
 * one template field; with no row, the Paint Group wording is used (its
 * {{brand}} already names Paint Home). `forBrand` lays the rows over the
 * messaging settings for a Paint Home send and changes nothing for Paint
 * Group. Only string fields are ever overlaid.
 */
export type BrandWordingRow = { brand: string; field: string; body: string };
export type BrandWording = Record<string, Record<string, string>>;

export function brandWordingFrom(rows: readonly BrandWordingRow[]): BrandWording {
  const out: BrandWording = {};
  for (const r of rows) if (r.body?.trim()) (out[r.brand] ??= {})[r.field] = r.body;
  return out;
}

/** The messaging settings as `brand` reads them. PURE. */
export function forBrand(messaging: MessagingSettings, wording: BrandWording, brand: string): MessagingSettings {
  const over = wording[brand];
  if (!over) return messaging;
  const out: MessagingSettings = { ...messaging };
  for (const [field, body] of Object.entries(over)) {
    if (typeof (messaging as Record<string, unknown>)[field] === "string") (out as Record<string, unknown>)[field] = body;
  }
  return out;
}

/**
 * Every Paint Home row, read once per sweep. A refused read is returned as
 * the error and the caller sends Paint Group wording — the brand name is
 * still right — after reporting it; it is never mistaken for "no rows".
 */
export async function loadBrandWording(db: SupabaseClient): Promise<{ wording: BrandWording; error: string | null }> {
  const { data, error } = await db.from("automation_brand_wording").select("brand, field, body");
  if (error) return { wording: {}, error: error.message };
  return { wording: brandWordingFrom((data ?? []) as BrandWordingRow[]), error: null };
}
