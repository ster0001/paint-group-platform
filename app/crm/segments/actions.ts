"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { criteriaSchema, evaluateSegment, previewSegment, type Criterion } from "@/lib/crm/segments";
import { loadSubjects } from "@/lib/crm/loadSubjects";

export type SegmentResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

/**
 * The live answer under the builder: who matches these rules, right now.
 *
 * Runs the same evaluator the dry run and the sweep use, over the same loaded
 * subjects — so the number someone builds a list against is the number the
 * campaign will act on. A preview computed any other way is a lie waiting for
 * its moment.
 */
export async function previewCriteria(criteria: unknown): Promise<SegmentResult<{
  count: number;
  sample: Array<{ accountId: string; name: string; detail: string }>;
  worthCents: number | null;
  averageCents: number | null;
}>> {
  const parsed = criteriaSchema.safeParse(criteria);
  if (!parsed.success) return { ok: false, message: "Finish the rule you're editing first." };

  const supabase = await createClient();
  const subjects = await loadSubjects(supabase);
  const preview = previewSegment(subjects, {
    key: "__preview", name: "", description: "", criteria: parsed.data,
  });
  return {
    ok: true,
    message: `${preview.count} match today.`,
    data: preview,
  };
}

const nameSchema = z.string().trim().min(3).max(80);

export async function saveSegment(input: {
  key: string | null;   // null = create
  name: string;
  description: string;
  criteria: Criterion[];
}): Promise<SegmentResult<{ key: string }>> {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, message: "Give the list a name — three characters or more." };
  const criteria = criteriaSchema.safeParse(input.criteria);
  if (!criteria.success) return { ok: false, message: "At least one finished rule, so the list means something." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (input.key) {
    const { error } = await supabase.from("crm_segments")
      .update({ name: name.data, description: input.description.trim(), criteria: criteria.data })
      .eq("key", input.key);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/crm/segments");
    revalidatePath(`/crm/segments/${input.key}`);
    return { ok: true, message: "Saved. Every campaign pointed at this list reads the new rules from its next sweep.", data: { key: input.key } };
  }

  const key = name.data.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    + "-" + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from("crm_segments")
    .insert({ key, name: name.data, description: input.description.trim(), criteria: criteria.data, created_by: user?.id ?? null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/segments");
  return { ok: true, message: "List created.", data: { key } };
}

export async function deleteSegment(key: string): Promise<SegmentResult> {
  const supabase = await createClient();

  // A list a campaign points at is load-bearing: deleting it would leave the
  // campaign sweeping against nothing, silently. Refuse with the reason.
  const { data: using } = await supabase.from("campaigns")
    .select("name").eq("segment_key", key).limit(5);
  if (using?.length) {
    return { ok: false, message: `"${using[0].name}" still uses this list — point that campaign somewhere else first.` };
  }

  const { error } = await supabase.from("crm_segments").delete().eq("key", key);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/segments");
  return { ok: true, message: "Deleted." };
}

/** The list page's counts, computed once over one subjects load. */
export async function countSegments(
  segments: Array<{ key: string; criteria: Criterion[] }>,
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const subjects = await loadSubjects(supabase);
  const out: Record<string, number> = {};
  for (const s of segments) {
    out[s.key] = evaluateSegment(subjects, { key: s.key, name: "", description: "", criteria: s.criteria }).length;
  }
  return out;
}
