import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { SHOWCASE_COLUMNS, showcaseJobRowSchema, type ShowcaseJob } from "./schema";

/**
 * Staff-side reads for Settings → Showcase (session 3). Under the staff
 * session and the `showcase_jobs_staff_read` policy — drafts included,
 * never the service key (a staff screen sees what staff may see).
 */
export async function listShowcaseJobsForStaff(): Promise<ShowcaseJob[]> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return [];
  const { data } = await supabase
    .from("showcase_jobs").select(SHOWCASE_COLUMNS)
    .order("published", { ascending: false })
    .order("featured_rank", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(500);
  return (data ?? []).flatMap((r) => { const p = showcaseJobRowSchema.safeParse(r); return p.success ? [p.data] : []; });
}

export async function getShowcaseJobForStaff(id: string): Promise<ShowcaseJob | null> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return null;
  const { data } = await supabase.from("showcase_jobs").select(SHOWCASE_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const p = showcaseJobRowSchema.safeParse(data);
  return p.success ? p.data : null;
}

export type EstimatePick = { id: string; title: string; status: string; created_at: string };

/** Estimates the editor can link a job to — searched client-side by title (the job address). */
export async function listEstimatesForLinking(): Promise<EstimatePick[]> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return [];
  const { data } = await supabase
    .from("estimates").select("id, title, status, created_at")
    .order("created_at", { ascending: false }).limit(400);
  return (data ?? []).map((e) => ({
    id: e.id as string, title: ((e.title as string | null) ?? "").trim() || "(untitled)",
    status: (e.status as string | null) ?? "", created_at: (e.created_at as string | null) ?? "",
  }));
}
