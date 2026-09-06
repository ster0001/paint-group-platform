"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { CORRECTION_REASONS, correctionFrom, type Correction } from "@/lib/wizard/correction";

/**
 * Phase 3 (6 Sep estimator plan): tag WHY a wizard estimate was corrected.
 *
 * Stored on the estimate at `builder_state.wizard.correction` — no new
 * column, no migration. Staff session, staff RLS. The write is a
 * read-merge-write of builder_state, so only the `wizard.correction` key
 * changes; an estimate open in the builder at the same moment keeps its
 * blocks (the builder's own save spreads the loaded state).
 */

const inputSchema = z.object({
  estimateId: z.string().uuid(),
  reasons: z.array(z.enum(CORRECTION_REASONS.map(([k]) => k) as [string, ...string[]])).max(8),
  note: z.string().trim().max(600).default(""),
});

export type SaveCorrectionResult = { status: "saved"; correction: Correction | null } | { status: "error"; message: string };

export async function saveCorrectionAction(raw: unknown): Promise<SaveCorrectionResult> {
  const supabase = await createClient();
  const staff = await requireStaff(supabase);
  if (!staff) return { status: "error", message: "Staff only." };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Pick at least one reason, or write a note." };
  const { estimateId, reasons, note } = parsed.data;

  const { data: row, error: readError } = await supabase.from("estimates").select("builder_state").eq("id", estimateId).maybeSingle();
  if (readError || !row) return { status: "error", message: "Couldn't read that estimate." };
  const state = (row.builder_state ?? {}) as Record<string, unknown>;
  const wizard = ((state.wizard as Record<string, unknown> | undefined) ?? {});
  const correction = reasons.length === 0 && !note
    ? null
    : { reasons, note, taggedAt: new Date().toISOString(), taggedBy: staff.id };
  const next = { ...state, wizard: { ...wizard, correction } };
  const { error } = await supabase.from("estimates").update({ builder_state: next }).eq("id", estimateId);
  if (error) return { status: "error", message: "Couldn't save the tag — please try again." };
  revalidatePath("/proving");
  return { status: "saved", correction: correctionFrom(correction) };
}
