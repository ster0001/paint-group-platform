import { createClient } from "@supabase/supabase-js";
import { SHOWCASE_COLUMNS, showcaseJobRowSchema, type ShowcaseJob } from "./schema";

/**
 * Public reads for the marketing pages (homepage cards, /work, /work/[slug]).
 *
 * These pages are statically generated with ISR (brief §4.4c), so they read
 * with a cookie-less anon client: no session, no request context, and the
 * `showcase_jobs_public_read` policy (published = true) is the only thing
 * that decides what comes back. Never the service key here — a public page
 * must see exactly what the public sees.
 */
function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function rows(data: unknown[] | null): ShowcaseJob[] {
  return (data ?? []).flatMap((r) => {
    const parsed = showcaseJobRowSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

/** §4.4c AC: the three lowest featured ranks among PUBLISHED jobs, nothing else. */
export async function featuredShowcaseJobs(): Promise<ShowcaseJob[]> {
  const db = publicClient();
  if (!db) return [];
  const { data } = await db
    .from("showcase_jobs").select(SHOWCASE_COLUMNS)
    .eq("published", true).not("featured_rank", "is", null)
    .order("featured_rank", { ascending: true }).limit(3);
  return rows(data);
}

/** /work — every published job, newest completed first. */
export async function publishedShowcaseJobs(): Promise<ShowcaseJob[]> {
  const db = publicClient();
  if (!db) return [];
  const { data } = await db
    .from("showcase_jobs").select(SHOWCASE_COLUMNS)
    .eq("published", true)
    .order("completed_on", { ascending: false, nullsFirst: false })
    .limit(500);
  return rows(data);
}

export async function showcaseJobBySlug(slug: string): Promise<ShowcaseJob | null> {
  const db = publicClient();
  if (!db) return null;
  const { data } = await db.from("showcase_jobs").select(SHOWCASE_COLUMNS).eq("published", true).eq("slug", slug).maybeSingle();
  if (!data) return null;
  const parsed = showcaseJobRowSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** The homepage's featured review video: one PUBLISHED job by id (Settings → Website). */
export async function showcaseJobById(id: string): Promise<ShowcaseJob | null> {
  const db = publicClient();
  if (!db) return null;
  const { data } = await db.from("showcase_jobs").select(SHOWCASE_COLUMNS).eq("published", true).eq("id", id).maybeSingle();
  if (!data) return null;
  const parsed = showcaseJobRowSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** §4.4c block 9 — three other published jobs, same job type first. */
export function relatedShowcaseJobs(all: ShowcaseJob[], current: ShowcaseJob, n = 3): ShowcaseJob[] {
  const others = all.filter((j) => j.id !== current.id);
  const same = others.filter((j) => j.job_type === current.job_type);
  const rest = others.filter((j) => j.job_type !== current.job_type);
  return [...same, ...rest].slice(0, n);
}
