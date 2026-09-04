"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { WEBSITE_CONTENT_KEY, websiteContentSchema, type WebsiteContent } from "@/lib/marketing/siteContent";
import { plainIssues } from "@/lib/showcase/schema";

/** Settings → Website: one row, staff-only under the settings policy, then the public pages revalidate. */
export type SaveWebsiteResult = { status: "saved"; content: WebsiteContent } | { status: "invalid"; issues: string[] } | { status: "error"; message: string };

export async function saveWebsiteContentAction(raw: unknown): Promise<SaveWebsiteResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { status: "error", message: "Staff only." };
  const parsed = websiteContentSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", issues: plainIssues(parsed.error) };
  const { error } = await supabase.from("settings").upsert({ key: WEBSITE_CONTENT_KEY, value: parsed.data }, { onConflict: "key" });
  if (error) return { status: "error", message: "Couldn't save — please try again." };
  revalidatePath("/");
  revalidatePath("/work");
  return { status: "saved", content: parsed.data };
}
