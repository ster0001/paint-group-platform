"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { CRM_SETTINGS_KEY, mergeThresholds, THRESHOLD_FIELDS, type CrmThresholds } from "@/lib/crm/thresholds";
import type { TagRow } from "./CrmSettings";

type Result = { ok: true } | { ok: false; message: string };

/** Settings → CRM: one row, validated against each field's range. */
export async function saveCrmThresholdsAction(raw: unknown): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const merged = mergeThresholds(raw);
  const bad = THRESHOLD_FIELDS.find((f) => {
    const v = (raw as Record<string, unknown> | null)?.[f.key];
    return typeof v === "number" && (v < f.min || v > f.max);
  });
  if (bad) return { ok: false, message: `${bad.label}: between ${bad.min} and ${bad.max} ${bad.unit}.` };
  const { error } = await supabase.from("settings").upsert({ key: CRM_SETTINGS_KEY, value: merged as CrmThresholds }, { onConflict: "key" });
  if (error) return { ok: false, message: "Couldn't save — please try again." };
  revalidatePath("/crm", "layout");
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveCrmTagAction(label: string): Promise<Result & { tag?: TagRow }> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const clean = label.trim();
  if (!clean) return { ok: false, message: "A tag needs a name." };
  const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const { error } = await supabase.rpc("crm_upsert_tag", { p_key: key, p_label: clean, p_colour: null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm", "layout");
  return { ok: true, tag: { key, label: clean, colour: null, sort_order: 100 } };
}

export async function deleteCrmTagAction(key: string): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const { error } = await supabase.rpc("crm_delete_tag", { p_key: key });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm", "layout");
  return { ok: true };
}
