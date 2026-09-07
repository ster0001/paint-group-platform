"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { loadViews, VIEWS_KEY, type SavedView } from "./data";

type Result = { ok: true; key?: string } | { ok: false; message: string };
const ALLOWED = new Set(["view", "sort", "f", "q", "state", "tag", "owner", "temp", "life"]);

/** One Settings row holds every saved view — office-wide, staff-editable. */
export async function saveView(name: string, params: Record<string, string>): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false, message: "A view needs a name." };
  const safe = Object.fromEntries(Object.entries(params).filter(([k, v]) => ALLOWED.has(k) && typeof v === "string" && v).map(([k, v]) => [k, v.slice(0, 80)]));
  const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `view-${Date.now()}`;
  const views = (await loadViews(supabase)).filter((v) => v.key !== key);
  const next: SavedView[] = [...views, { key, name: clean, params: safe }].slice(-30);
  const { error } = await supabase.from("settings").upsert({ key: VIEWS_KEY, value: next }, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/customers");
  return { ok: true, key };
}

export async function deleteView(key: string): Promise<Result> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  const views = (await loadViews(supabase)).filter((v) => v.key !== key);
  const { error } = await supabase.from("settings").upsert({ key: VIEWS_KEY, value: views }, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/customers");
  return { ok: true };
}
