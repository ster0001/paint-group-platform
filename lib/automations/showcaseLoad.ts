/**
 * The showcase jobs a message may point at (L4, R5), read once per sweep with
 * the service client — published rows only, the same set the public /work
 * pages show — plus the Paint Home ceiling Paint Home customers are held to.
 * SERVER ONLY. A refused read throws: "no job to show" and "we could not
 * look" must never look alike.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_POLICY, policyFromSettings } from "@/lib/wizard/policy";
import { formatPriceRange } from "@/lib/showcase/format";
import type { PickableShowcase } from "./showcasePick";

export async function loadShowcaseForMessages(db: SupabaseClient): Promise<{ jobs: PickableShowcase[]; paintHomeCapCents: number }> {
  const [jobs, policy] = await Promise.all([
    db.from("showcase_jobs").select("slug, suburb, job_type, property_type, published, price_low_cents, price_high_cents, completed_on").eq("published", true).limit(500),
    db.from("settings").select("value").eq("key", "wizard_policy").maybeSingle(),
  ]);
  if (jobs.error) throw new Error(`showcase: ${jobs.error.message}`);
  if (policy.error) throw new Error(`wizard_policy: ${policy.error.message}`);
  const cap = (policy.data ? policyFromSettings((policy.data as { value: unknown }).value) : DEFAULT_POLICY).paintHomeCapCents;
  return { jobs: (jobs.data ?? []) as PickableShowcase[], paintHomeCapCents: cap };
}

/** {{showcase_suburb}}, {{showcase_range}}, {{showcase_link}} for one job (empty strings with none). */
export function showcaseVars(job: PickableShowcase | null, origin: string): { showcase_suburb: string; showcase_range: string; showcase_link: string } {
  if (!job || job.price_low_cents == null || job.price_high_cents == null) return { showcase_suburb: "", showcase_range: "", showcase_link: "" };
  return { showcase_suburb: job.suburb, showcase_range: formatPriceRange(job.price_low_cents, job.price_high_cents), showcase_link: `${origin}/work/${job.slug}` };
}
