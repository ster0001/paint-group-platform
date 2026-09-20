"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";

/**
 * The estimate chat, read by the staff dock (Tom, 20 Sep: the customer's
 * chat messages reach the chat in the software). Staff session, RLS-read;
 * replies go through the builder's own replyToEstimateChatAction so the
 * customer is told exactly as they are from the estimate page.
 */
export type EstimateChatMessage = { id: string; direction: "staff" | "customer"; body: string; author_name: string | null; created_at: string };

export async function staffEstimateThreadAction(raw: unknown): Promise<{ messages: EstimateChatMessage[]; shareToken: string | null } | null> {
  const parsed = z.object({ estimateId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return null;
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return null;
  const [{ data: msgs, error }, { data: est, error: estErr }] = await Promise.all([
    supabase.from("estimate_messages").select("id, direction, body, author_name, created_at").eq("estimate_id", parsed.data.estimateId).order("created_at").limit(200),
    supabase.from("estimates").select("share_token").eq("id", parsed.data.estimateId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (estErr) throw new Error(estErr.message);
  return { messages: (msgs ?? []) as EstimateChatMessage[], shareToken: (est as { share_token: string | null } | null)?.share_token ?? null };
}
