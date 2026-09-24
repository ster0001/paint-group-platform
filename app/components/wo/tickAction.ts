"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SURFACE_STATES } from "@/lib/workorder/surfaces";
import { applyColourRecordsForTick } from "@/lib/colourRecords/transitions";
import { draftUpdateFromTodaysTicks } from "@/lib/workorder/draftFromTicks";

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
  | { ok: false; message: string; needsPhoto?: string; needsAfterPhoto?: string };

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
    if (parsed.data.to === "done") {
      // Best-effort (the seedSurfaces precedent): the property's colour
      // record follows the tick, but a record hiccup never blocks the tick.
      try { await applyColourRecordsForTick(parsed.data.surfaceId, null); } catch { /* deliberate */ }
    }
    // Ticked work lands in the day's progress-update draft NOW, not at the
    // overnight sweep (Tom, 1 Sep) — the composer on the PC job page and the
    // drafted-updates reminder card pick it up on their next render.
    // Best-effort behind after(): a draft hiccup never un-ticks anything.
    const service = createServiceClient();
    if (service) {
      const surfaceId = parsed.data.surfaceId;
      after(() => draftUpdateFromTodaysTicks(service, surfaceId).catch(() => {}));
    }
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
  if (reason.startsWith("after_photo_required:")) {
    const heading = reason.slice("after_photo_required:".length);
    return {
      ok: false,
      needsAfterPhoto: heading,
      message: `Take a finished photo of ${heading} first — it completes the area's record.`,
    };
  }
  if (reason.startsWith("not_in_progress:")) return { ok: false, message: "This job isn't open for ticking yet." };
  if (reason === "not_yours") return { ok: false, message: "That job isn't yours." };
  return { ok: false, message: "Couldn't save that tick." };
}

/**
 * "Photos not required" on one line of the scope (Tom, 24 Sep 2026) — a fuel
 * allowance, a site set-up line. Staff only (the RPC refuses anyone else); the
 * painter's list stops asking for a before/finished shot on that row and the
 * heading's photo gates are counted over the rows that still need them.
 */
export type PhotosOptionalResult = { ok: true; optional: boolean } | { ok: false; message: string };

export async function setSurfacePhotosOptionalAction(raw: unknown): Promise<PhotosOptionalResult> {
  const parsed = z.object({ surfaceId: z.string().uuid(), optional: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_set_surface_photos_optional", {
    p_surface_id: parsed.data.surfaceId, p_optional: parsed.data.optional,
  });
  if (error) {
    if (/wo_set_surface_photos_optional/.test(error.message)) {
      return { ok: false, message: "This needs database migration 20270198 run first — nothing was changed." };
    }
    return { ok: false, message: error.message };
  }
  const s = String(data ?? "");
  if (s === "ok:true" || s === "ok:false") {
    revalidatePath("/portal/jobs");
    revalidatePath("/pc");
    return { ok: true, optional: s === "ok:true" };
  }
  if (s === "error:not_staff") return { ok: false, message: "Staff only." };
  if (s === "error:closed") return { ok: false, message: "This job is closed — its tick list is final." };
  return { ok: false, message: s.replace("error:", "").replace(/_/g, " ") || "That didn't save." };
}
