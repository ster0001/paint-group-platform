"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";
import { slugify } from "./format";
import {
  SHOWCASE_COLUMNS, plainIssues, publishChecklist, showcaseJobInputSchema, showcaseJobRowSchema,
  type ShowcaseJob,
} from "./schema";

/**
 * THE write path for showcase_jobs (homepage brief §4.4a/b): one server
 * action, zod first, staff-only, through the service client — the table has
 * no client write policy at all, so nothing else can write it.
 *
 * What it decides, in order:
 *  1. who is asking (a staff session, proven through their own client);
 *  2. is the input well-formed (zod, plain-English issues back);
 *  3. slug: derived from title + suburb on create, kept unique by suffix,
 *     and LOCKED once the job has been published;
 *  4. publish: refused with the checklist while anything is missing;
 *  5. featured rank: 1–3 are unique — a taken rank comes back as
 *     `rank_taken` so the editor can ask which job to replace, and
 *     `displace_featured: true` on the retry moves the holder off the rank;
 *  6. write, then revalidate the public pages (ISR, §4.4b AC "live within 60s").
 */

export type SaveShowcaseResult =
  | { status: "saved"; job: ShowcaseJob }
  | { status: "invalid"; issues: string[] }
  | { status: "publish_blocked"; checklist: string[] }
  | { status: "rank_taken"; rank: number; holder: { id: string; title: string; suburb: string } }
  | { status: "error"; message: string };

export async function saveShowcaseJobAction(raw: unknown): Promise<SaveShowcaseResult> {
  const supabase = await createClient();
  const staff = await requireStaff(supabase);
  if (!staff) return { status: "error", message: "Staff only." };

  const parsed = showcaseJobInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", issues: plainIssues(parsed.error) };
  const input = parsed.data;

  const db = createServiceClient();
  if (!db) return { status: "error", message: "The service key isn't configured on this machine." };

  try {
    // ---- the existing row, when editing ------------------------------------
    let existing: ShowcaseJob | null = null;
    if (input.id) {
      const { data, error } = await db.from("showcase_jobs").select(SHOWCASE_COLUMNS).eq("id", input.id).maybeSingle();
      if (error) throw error;
      if (!data) return { status: "error", message: "That job no longer exists." };
      existing = showcaseJobRowSchema.parse(data);
    }

    // ---- slug --------------------------------------------------------------
    let slug = input.slug ?? existing?.slug ?? slugify(input.title, input.suburb);
    if (existing?.published && slug !== existing.slug) {
      return { status: "invalid", issues: ["The web address (slug) is locked once a job is published."] };
    }
    if (!existing || slug !== existing.slug) slug = await uniqueSlug(db, slug, existing?.id ?? null);

    // ---- publish checklist -------------------------------------------------
    if (input.published) {
      const checklist = publishChecklist(input);
      if (checklist.length) return { status: "publish_blocked", checklist };
    }

    // ---- featured rank -----------------------------------------------------
    if (input.featured_rank != null) {
      let q = db.from("showcase_jobs").select("id, title, suburb").eq("featured_rank", input.featured_rank);
      if (existing) q = q.neq("id", existing.id);
      const { data: holder, error } = await q.maybeSingle();
      if (error) throw error;
      if (holder) {
        if (!input.displace_featured) {
          return { status: "rank_taken", rank: input.featured_rank, holder: { id: holder.id as string, title: holder.title as string, suburb: holder.suburb as string } };
        }
        const { error: clearErr } = await db.from("showcase_jobs").update({ featured_rank: null }).eq("id", holder.id as string);
        if (clearErr) throw clearErr;
      }
    }

    // ---- write -------------------------------------------------------------
    const { id: _id, displace_featured: _d, slug: _s, ...fields } = input;
    void _id; void _d; void _s;
    const row = { ...fields, slug };
    const write = existing
      ? db.from("showcase_jobs").update(row).eq("id", existing.id).select(SHOWCASE_COLUMNS).single()
      : db.from("showcase_jobs").insert(row).select(SHOWCASE_COLUMNS).single();
    const { data, error } = await write;
    if (error) {
      if (error.code === "23505") return { status: "invalid", issues: ["Another job already uses that web address (slug) or featured rank."] };
      if (error.code === "23514") return { status: "invalid", issues: ["Something in this job breaks a rule the database enforces — check the price range, days on site and slug."] };
      throw error;
    }
    const job = showcaseJobRowSchema.parse(data);

    // ---- ISR: the public pages pick the change up on their next request ----
    revalidatePath("/");
    revalidatePath("/work");
    revalidatePath(`/work/${job.slug}`);
    if (existing && existing.slug !== job.slug) revalidatePath(`/work/${existing.slug}`);

    return { status: "saved", job };
  } catch (e) {
    reportError(e, { where: "showcase.save", extra: { jobId: input.id ?? null } });
    return { status: "error", message: "Couldn't save the job — please try again." };
  }
}

/** The staff list for Settings → Showcase (session 3): every row, drafts included, under the staff read policy. */
export async function listShowcaseJobsForStaff(): Promise<ShowcaseJob[]> {
  const supabase = await createClient();
  const staff = await requireStaff(supabase);
  if (!staff) return [];
  const { data } = await supabase.from("showcase_jobs").select(SHOWCASE_COLUMNS).order("updated_at", { ascending: false }).limit(500);
  return (data ?? []).flatMap((r) => { const p = showcaseJobRowSchema.safeParse(r); return p.success ? [p.data] : []; });
}

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

/** `slug`, then `slug-2`, `slug-3`… until one is free (excluding the row being edited). */
async function uniqueSlug(db: Db, base: string, selfId: string | null): Promise<string> {
  const { data, error } = await db.from("showcase_jobs").select("id, slug").like("slug", `${base}%`);
  if (error) throw error;
  const taken = new Set((data ?? []).filter((r) => r.id !== selfId).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 80 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not find a free slug");
}
