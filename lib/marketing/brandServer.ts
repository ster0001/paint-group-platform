import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { EMPTY_BRAND_SETTINGS, brandFor, parseBrandSettings, type Brand, type BrandSettings } from "./brand";
import type { Audience } from "./audience";

/**
 * Settings → Brands (Paint Home brief §6): one settings row, key `brands`,
 * the editable face of lib/marketing/brand.ts. Public pages read it
 * server-side with the service client (same as getWebsiteContent) — ISR,
 * revalidated by the save action. A read that fails is REPORTED and the
 * page renders the defaults; it never renders blank (CLAUDE.md: a dropped
 * `error` is "there is nothing here").
 */
export const BRANDS_SETTINGS_KEY = "brands";

export async function getBrandSettings(): Promise<BrandSettings> {
  const svc = createServiceClient();
  if (!svc) return EMPTY_BRAND_SETTINGS;
  const { data, error } = await svc.from("settings").select("value").eq("key", BRANDS_SETTINGS_KEY).maybeSingle();
  if (error) {
    reportError(error, { where: "marketing.brands.read" });
    return EMPTY_BRAND_SETTINGS;
  }
  return parseBrandSettings(data?.value);
}

/** The brand for this audience with Tom's edits laid over the defaults. */
export async function getBrand(audience: Audience): Promise<Brand> {
  return brandFor(audience, await getBrandSettings());
}
