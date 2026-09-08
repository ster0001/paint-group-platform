"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { CORRECTION_REASONS, correctionFrom, type Correction } from "@/lib/wizard/correction";
import { exclusionFrom } from "@/lib/wizard/proving";

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

/**
 * Tom, 9 Sep 2026: take rows off the Proving window that aren't a fair test.
 *
 * NOT a delete. The row is an estimate — often a real job — so this sets a
 * flag beside the correction tag (`builder_state.wizard.provingExcluded`)
 * and the page stops counting it. Reversible, and the estimate, its history
 * and its snapshot are untouched. Takes a list so "remove all" is one action.
 */
const excludeSchema = z.object({
  estimateIds: z.array(z.string().uuid()).min(1).max(200),
  excluded: z.boolean(),
  reason: z.string().trim().max(200).default(""),
});

export type ExcludeResult = { status: "saved"; changed: number } | { status: "error"; message: string };

export async function setProvingExcludedAction(raw: unknown): Promise<ExcludeResult> {
  const supabase = await createClient();
  const staff = await requireStaff(supabase);
  if (!staff) return { status: "error", message: "Staff only." };
  const parsed = excludeSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Nothing to change." };
  const { estimateIds, excluded, reason } = parsed.data;

  const { data: rows, error: readError } = await supabase
    .from("estimates").select("id, builder_state").in("id", estimateIds);
  if (readError) return { status: "error", message: "Couldn't read those estimates." };

  const value = excluded ? exclusionFrom({ at: new Date().toISOString(), by: staff.id, reason }) : null;

  // Read-merge-write per estimate, exactly as the correction tag does: only
  // the one wizard key moves, so an estimate open in the builder keeps its
  // blocks. In chunks, in parallel — "remove all" on a full window is 200
  // writes, and serially that is a minute of the button saying "Saving…".
  const writes = (rows ?? []).flatMap((row) => {
    const state = (row.builder_state ?? {}) as Record<string, unknown>;
    const wizard = ((state.wizard as Record<string, unknown> | undefined) ?? {});
    if ((wizard.provingExcluded ?? null) === null && !excluded) return [];
    // Putting a row back REMOVES the key rather than writing JSON null — a
    // null left in the JSON still answers `provingExcluded is null` as false
    // to a Postgres filter, so a cleanup that looks for excluded rows would
    // find these for ever (it did, on the 65k-row test project).
    const nextWizard: Record<string, unknown> = { ...wizard };
    if (value) nextWizard.provingExcluded = value;
    else delete nextWizard.provingExcluded;
    return [{ id: row.id as string, builder_state: { ...state, wizard: nextWizard } }];
  });

  let changed = 0;
  for (let at = 0; at < writes.length; at += 25) {
    const results = await Promise.all(writes.slice(at, at + 25).map((w) =>
      supabase.from("estimates").update({ builder_state: w.builder_state }).eq("id", w.id)));
    changed += results.filter((r) => !r.error).length;
  }
  if (changed === 0) return { status: "error", message: "Nothing changed — try again." };
  revalidatePath("/proving");
  return { status: "saved", changed };
}
