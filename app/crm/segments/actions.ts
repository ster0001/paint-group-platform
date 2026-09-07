"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audienceSchema, ruleCount, RuleError, type Audience } from "@/lib/crm/segments";
import { countAudience, sampleAudience } from "@/lib/crm/audience";

export type SegmentResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

export type AudiencePreview = {
  count: number;
  sample: Array<{ accountId: string; name: string; detail: string }>;
  /** "Worth roughly $847k at your average job" — an ESTIMATE, labelled as one. */
  worthCents: number | null;
  averageCents: number | null;
};

const said = (e: unknown): string =>
  e instanceof RuleError ? e.message : e instanceof Error && /audience:/.test(e.message) ? e.message.replace(/^.*audience: /, "") : "Couldn't run that list.";

/**
 * The live answer under the builder: who matches these rules, right now.
 *
 * Runs in SQL over the facts layer — the same functions the sweep and the
 * send-time guard call — so the number someone builds a list against is the
 * number the campaign will act on, at any size, in milliseconds.
 */
export async function previewAudience(audience: unknown): Promise<SegmentResult<AudiencePreview>> {
  const parsed = audienceSchema.safeParse(audience);
  if (!parsed.success || ruleCount(parsed.data) === 0) return { ok: false, message: "Finish the rule you're editing first." };
  const supabase = await createClient();
  try {
    const [count, sample, { data: won }] = await Promise.all([
      countAudience(supabase, parsed.data),
      sampleAudience(supabase, parsed.data, 20),
      // The average comes from everyone who has ever had work done, not from
      // the list — a list of people who have never bought would average zero.
      supabase.from("crm_account_facts").select("won_cents").gt("won_cents", 0).order("last_job_completed_at", { ascending: false, nullsFirst: false }).limit(2000),
    ]);
    const priors = (won ?? []).map((r) => Number(r.won_cents) || 0);
    const averageCents = priors.length ? Math.round(priors.reduce((a, b) => a + b, 0) / priors.length) : null;
    return {
      ok: true,
      message: `${count.toLocaleString("en-AU")} match today.`,
      data: {
        count,
        sample: sample.map((s) => ({
          accountId: s.account_id,
          name: s.name || s.email || "Unnamed",
          detail: [s.suburb, s.last_job_completed_at
            ? new Date(s.last_job_completed_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
            : null].filter(Boolean).join(" · "),
        })),
        worthCents: averageCents == null ? null : averageCents * count,
        averageCents,
      },
    };
  } catch (e) {
    return { ok: false, message: said(e) };
  }
}

const nameSchema = z.string().trim().min(3).max(80);

export async function saveSegment(input: {
  key: string | null;   // null = create
  name: string;
  description: string;
  audience: Audience;
}): Promise<SegmentResult<{ key: string }>> {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, message: "Give the list a name — three characters or more." };
  const audience = audienceSchema.safeParse(input.audience);
  if (!audience.success || ruleCount(audience.data) === 0) return { ok: false, message: "At least one finished rule, so the list means something." };
  // A rule the database would refuse is refused here, with the reason.
  try {
    const { compileAudience } = await import("@/lib/crm/segments");
    compileAudience(audience.data);
  } catch (e) {
    return { ok: false, message: said(e) };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (input.key) {
    const { error } = await supabase.from("crm_segments")
      .update({ name: name.data, description: input.description.trim(), rules: audience.data })
      .eq("key", input.key);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/crm/segments");
    revalidatePath(`/crm/segments/${input.key}`);
    return { ok: true, message: "Saved. Every campaign pointed at this list reads the new rules from its next sweep.", data: { key: input.key } };
  }

  const key = name.data.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    + "-" + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from("crm_segments")
    .insert({ key, name: name.data, description: input.description.trim(), rules: audience.data, criteria: [], created_by: user?.id ?? null });
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
