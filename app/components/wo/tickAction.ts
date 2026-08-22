"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SURFACE_STATES } from "@/lib/workorder/surfaces";

/**
 * Ticking a surface — from the painter's phone OR the office.
 *
 * wo_tick_surface has always allowed staff: a coordinator on a quality visit
 * marks work off on the painter's behalf, and the event records that it was
 * staff who did it. The rules — ownership, the before-photo gate, whether the
 * job is even in progress — all live in the RPC. This only turns its answer
 * into something worth reading.
 */
export type TickResult =
  | { ok: true; state: string }
  | { ok: false; message: string; needsPhoto?: string };

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
    revalidatePath("/pc");
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
  if (reason.startsWith("not_in_progress:")) return { ok: false, message: "This job isn't open for ticking yet." };
  if (reason === "not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that tick." };
}
