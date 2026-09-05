"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/supabase/guards";
import { AUDIENCES } from "@/lib/marketing/audience";
import { CONTENT_FIELDS } from "@/lib/marketing/copy/schema";
import { reportError } from "@/lib/monitoring/report";

/**
 * Session 8 §3 — the ONE writer of site_content, and of review tags (§5).
 * Staff only (owner/admin = the staff role; see lib/staff), zod'd, through
 * the service client because the table has no client write policy. Saves
 * revalidate both homepages and /work at once (ISR does the rest).
 */
const KNOWN = new Set(CONTENT_FIELDS.map((f) => `${f.section}.${f.key}`));

const saveSchema = z.object({
  audience: z.enum(AUDIENCES),
  entries: z.array(z.object({
    section: z.string().regex(/^[a-z_]{2,40}$/),
    key: z.string().regex(/^[a-z0-9_]{1,60}$/),
    value: z.string().max(20000),
  })).max(400),
});

export type SaveSiteContentResult = { status: "saved"; count: number } | { status: "error"; message: string };

export async function saveSiteContentAction(raw: unknown): Promise<SaveSiteContentResult> {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  if (!user) return { status: "error", message: "Staff only." };
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Check the fields." };
  const svc = createServiceClient();
  if (!svc) return { status: "error", message: "Service key not configured." };
  const { audience, entries } = parsed.data;
  const rows = entries.filter((e) => KNOWN.has(`${e.section}.${e.key}`)).map((e) => ({
    audience, section: e.section, key: e.key, sort: 0, value: e.value, updated_by: user.id,
  }));
  if (rows.length === 0) return { status: "saved", count: 0 };
  try {
    const { error } = await svc.from("site_content").upsert(rows, { onConflict: "tenant_id,audience,section,key,sort" });
    if (error) throw new Error(error.message);
  } catch (e) {
    reportError(e, { where: "settings.siteContent.save" });
    return { status: "error", message: e instanceof Error ? e.message : "That didn't save." };
  }
  revalidatePath("/"); revalidatePath("/business"); revalidatePath("/work");
  return { status: "saved", count: rows.length };
}

const tagSchema = z.object({ reviewKey: z.string().min(3).max(200), audience: z.enum(AUDIENCES).nullable() });

export async function setReviewTagAction(raw: unknown): Promise<{ status: "saved" } | { status: "error"; message: string }> {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  if (!user) return { status: "error", message: "Staff only." };
  const parsed = tagSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Check the tag." };
  const svc = createServiceClient();
  if (!svc) return { status: "error", message: "Service key not configured." };
  const { error } = await svc.from("review_tags").update({ audience: parsed.data.audience }).eq("review_key", parsed.data.reviewKey);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/"); revalidatePath("/business");
  return { status: "saved" };
}
