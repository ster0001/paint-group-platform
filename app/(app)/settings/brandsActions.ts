"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { brandSettingsSchema, type BrandSettings } from "@/lib/marketing/brand";
import { BRANDS_SETTINGS_KEY } from "@/lib/marketing/brandServer";
import { plainIssues } from "@/lib/showcase/schema";

/**
 * Settings → Brands (Paint Home brief §6): one row, staff-only under the
 * settings policy, zod'd, then every public page revalidates (the brand is
 * on the nav, the footer and the schema of all of them).
 */
export type SaveBrandsResult = { status: "saved"; settings: BrandSettings } | { status: "invalid"; issues: string[] } | { status: "error"; message: string };

export async function saveBrandSettingsAction(raw: unknown): Promise<SaveBrandsResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { status: "error", message: "Staff only." };
  const parsed = brandSettingsSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", issues: plainIssues(parsed.error) };
  const { error } = await supabase.from("settings").upsert({ key: BRANDS_SETTINGS_KEY, value: parsed.data }, { onConflict: "key" });
  if (error) return { status: "error", message: "Couldn't save — please try again." };
  for (const p of ["/", "/business", "/painthome", "/work"]) revalidatePath(p);
  return { status: "saved", settings: parsed.data };
}
