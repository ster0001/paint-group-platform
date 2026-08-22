"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SURFACE_STATES } from "@/lib/workorder/surfaces";

/**
 * Ticking a surface off, from the contractor's phone.
 *
 * The rules — who owns the job, whether the elevation has its before-photo,
 * whether the job is even in progress — all live in wo_tick_surface. This
 * translates its answer into something worth reading on a phone. The
 * before-photo refusal in particular has to read as an instruction, not a
 * failure: the painter hasn't done anything wrong, there's just a photo owing.
 */

export type TickResult = { ok: true; state: string } | { ok: false; message: string; needsPhoto?: string };

const tickInput = z.object({
  surfaceId: z.string().uuid(),
  to: z.enum(SURFACE_STATES),
});

export async function tickSurfaceAction(raw: unknown): Promise<TickResult> {
  const parsed = tickInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That tick didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_surface", {
    p_surface_id: parsed.data.surfaceId,
    p_to: parsed.data.to,
  });
  if (error) return { ok: false, message: "Couldn't save that just now — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true, state: s.slice(3) };
  }

  const reason = s.replace("error:", "");
  if (reason.startsWith("before_photo_required:")) {
    const heading = reason.slice("before_photo_required:".length);
    return {
      ok: false,
      needsPhoto: heading,
      message: `Take a before photo of ${heading} first — it goes on the record for this job.`,
    };
  }
  if (reason.startsWith("not_in_progress:")) {
    return { ok: false, message: "This job isn't open for ticking yet." };
  }
  if (reason === "not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that tick." };
}


export type PrepResult = { ok: true } | { ok: false; message: string };

/**
 * Ticking a completion-prep item. The rules are the RPC's; this only turns its
 * answer into something worth reading on a phone.
 */
export async function tickPrepItem(raw: unknown): Promise<PrepResult> {
  const parsed = z.object({ itemId: z.string().uuid(), done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_checklist_item", {
    p_item_id: parsed.data.itemId, p_done: parsed.data.done,
  });
  if (error) return { ok: false, message: "Couldn't save that — check your signal and try again." };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/portal/jobs");
    return { ok: true };
  }
  if (s === "error:not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that just now." };
}
