"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { templateSchema, type Template } from "@/lib/campaigns/blocks";
import { generateEmail } from "@/lib/campaigns/ai";
import { STANDING_SEGMENTS } from "@/lib/crm/segments";

export type StudioResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

const uuid = z.string().uuid();

export async function createTemplate(name: string, segmentKey: string | null): Promise<StudioResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("campaign_templates")
    .insert({ name: name.trim() || "Untitled email", segment_key: segmentKey, created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns");
  return { ok: true, message: "Started.", data: { id: data.id as string } };
}

/**
 * Save the draft.
 *
 * Any change clears `approved_at`: a template that was read and approved, then
 * edited, is not an approved template — and the send guard in the next session
 * reads that column.
 */
export async function saveTemplate(id: string, name: string, template: Template): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_templates").update({
    name: name.trim() || "Untitled email",
    subject: parsed.data.subject,
    preheader: parsed.data.preheader,
    blocks: parsed.data.blocks,
    approved_at: null,
    approved_by: null,
  }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/${id}`);
  revalidatePath("/crm/campaigns");
  return { ok: true, message: "Saved." };
}

export async function approveTemplate(id: string): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("campaign_templates")
    .update({ approved_at: new Date().toISOString(), approved_by: user?.id ?? null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/${id}`);
  return { ok: true, message: "Marked as read and approved. Nothing sends yet — sending is the next session." };
}

export async function deleteTemplate(id: string): Promise<StudioResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a template." };
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_templates").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns");
  return { ok: true, message: "Deleted." };
}

/**
 * "Write it for me".
 *
 * The facts list is the important input: the model may use those and nothing
 * else, and anything it says beyond them comes back as a warning on the draft.
 * Nothing is saved automatically — the writer sees it, then chooses.
 */
export async function writeWithAi(input: {
  goal: string;
  segmentKey: string | null;
  facts: string;
  ctaUrl: string;
  tone: "warm" | "plain" | "brief";
  existing?: Template | null;
}): Promise<StudioResult<{ template: Template; warnings: string[] }>> {
  const goal = input.goal.trim();
  if (goal.length < 8) return { ok: false, message: "Say what the email is for, in a sentence." };

  const supabase = await createClient();
  const { data: profileRow } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const companyName = ((profileRow?.value ?? {}) as { name?: string }).name || "Paint Group";

  const segment = STANDING_SEGMENTS.find((s) => s.key === input.segmentKey);
  const audience = segment ? `${segment.name} — ${segment.description}` : "Past and prospective customers.";

  const result = await generateEmail({
    goal,
    audience,
    facts: input.facts.split("\n").map((f) => f.replace(/^[-•]\s*/, "").trim()).filter(Boolean),
    ctaUrl: input.ctaUrl.trim() || "https://paintgroup.com.au/estimate",
    companyName,
    tone: input.tone,
    existing: input.existing ?? null,
  });

  if (!result.ok) return { ok: false, message: result.error };
  return {
    ok: true,
    message: result.warnings.length
      ? `Draft written — ${result.warnings.length} thing${result.warnings.length === 1 ? "" : "s"} to check.`
      : "Draft written.",
    data: { template: result.template, warnings: result.warnings },
  };
}
