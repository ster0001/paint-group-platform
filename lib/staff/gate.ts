import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { areaForPath, canSee, firstVisibleHref, parseStaffAccess, type StaffAreaKey, type StaffVisibility } from "./access";

// SERVER ONLY.

/** A staff profile's visibility, straight off the row (RLS: staff read profiles). */
export async function staffVisibility(supabase: SupabaseClient, userId: string): Promise<StaffVisibility> {
  const { data } = await supabase.from("profiles").select("is_owner, staff_access").eq("id", userId).maybeSingle();
  const row = (data ?? {}) as { is_owner?: boolean | null; staff_access?: unknown };
  return { isOwner: row.is_owner === true, access: parseStaffAccess(row.staff_access) };
}

/**
 * Every staff layout calls this after its role check. `area` names the
 * layout's own area (pc, crm, invoicing); the shared (app) shell passes
 * nothing and reads the path the proxy stamped on the request instead.
 * A hidden visitor is redirected to their first visible area — never a
 * dead end, never a 403 page.
 */
export async function gateStaffArea(vis: StaffVisibility, area?: StaffAreaKey): Promise<void> {
  let key: StaffAreaKey | null = area ?? null;
  if (!key) {
    const h = await headers();
    key = areaForPath(h.get("x-pathname") ?? "");
  }
  if (key && !canSee(vis, key)) redirect(firstVisibleHref(vis));
}
