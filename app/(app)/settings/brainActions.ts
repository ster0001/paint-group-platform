"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The Brain's approval screen (D14): Tom approves per entry; only approved,
 * written entries are ever served. Staff session client — RLS
 * (brain_entries_staff_write) is the gate, not this file.
 */

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "approved"]).optional(),
  answerMd: z.string().max(20000).optional(),
  audience: z.enum(["customer", "staff", "both"]).optional(),
  needsContent: z.boolean().optional(),
});

export async function saveBrainEntryAction(input: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Bad input." };
  const { id, status, answerMd, audience, needsContent } = parsed.data;
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (status) patch.status = status;
  if (answerMd != null) patch.answer_md = answerMd;
  if (audience) patch.audience = audience;
  if (needsContent != null) patch.needs_content = needsContent;
  if (status === "approved" && needsContent === true) return { ok: false, message: "An entry still marked “to write” can't be approved." };
  const { data: { user } } = await supabase.auth.getUser();
  patch.updated_by = user?.id ?? null;
  const { error } = await supabase.from("brain_entries").update(patch).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
