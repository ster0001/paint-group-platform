"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyColourRecordsForTick } from "@/lib/colourRecords/transitions";
import { draftUpdateForWorkOrder } from "@/lib/workorder/draftFromTicks";
import { SURFACE_GROUPS } from "@/lib/workorder/surfaceGroups";

/**
 * One tap, every room (work order UX Step 1). The rules — ownership, the stage,
 * the before-photo gate, R3 (painted only after prepped everywhere) and R5
 * (rooms already there are skipped) — live in `wo_tick_surface_group`; this
 * turns its answer into something worth reading on a phone, then does what the
 * single tick does after a success, ONCE for the whole tap rather than per row.
 */
export type BulkTickResult =
  | { ok: true; parentEventId: string | null; count: number; surfaceIds: string[] }
  | { ok: false; message: string; needsPhoto?: "job" };

const GROUP_CODES = SURFACE_GROUPS.map((g) => g.code) as [string, ...string[]];

const bulkInput = z.object({
  workOrderId: z.string().uuid(),
  groupCode: z.enum(GROUP_CODES),
  to: z.enum(["prepped", "done"]),
});

type RpcShape = { ok?: boolean; error?: string; parent_event_id?: string | null; count?: number; surface_ids?: string[] };

export async function bulkTickAction(raw: unknown): Promise<BulkTickResult> {
  const parsed = bulkInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That tap didn't make sense — pull down to refresh." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_tick_surface_group", {
    p_work_order_id: parsed.data.workOrderId,
    p_group_code: parsed.data.groupCode,
    p_to: parsed.data.to,
  });
  if (error) return { ok: false, message: "Couldn't save that just now — check your signal and try again." };

  const r = (data ?? {}) as RpcShape;
  if (r.ok) {
    const surfaceIds = r.surface_ids ?? [];
    if (parsed.data.to === "done") {
      // Best-effort, as the single tick: the property's colour record follows.
      for (const id of surfaceIds) {
        try { await applyColourRecordsForTick(id, null); } catch { /* deliberate */ }
      }
    }
    // Today's customer-update draft re-reads the day's ticks — once per tap.
    const service = createServiceClient();
    if (service && surfaceIds.length > 0) {
      const workOrderId = parsed.data.workOrderId;
      after(() => draftUpdateForWorkOrder(service, workOrderId).catch(() => {}));
    }
    revalidatePath("/portal/jobs");
    revalidatePath("/pc");
    return { ok: true, parentEventId: r.parent_event_id ?? null, count: r.count ?? 0, surfaceIds };
  }

  const reason = r.error ?? "";
  if (reason.startsWith("before_photo_required:")) {
    return { ok: false, needsPhoto: "job", message: "Step 1 first — tap the green Upload photos button above, then every row unlocks." };
  }
  if (reason === "not_all_prepped") return { ok: false, message: "Mark every room prepped first — then painted unlocks." };
  if (reason.startsWith("not_in_progress:")) return { ok: false, message: "This job isn't open for ticking yet." };
  if (reason === "not_yours") return { ok: false, message: "That job isn't yours." };
  if (reason === "no_rows") return { ok: false, message: "Nothing on this job is in that group — pull down to refresh." };
  return { ok: false, message: "Couldn't save that tap." };
}

export type UndoResult = { ok: true; count: number; surfaceIds: string[] } | { ok: false; message: string };

/** Undo the last bulk tap (R6): the server only honours it for 60 s and for the same user. */
export async function undoBulkTickAction(raw: unknown): Promise<UndoResult> {
  const parsed = z.object({ workOrderId: z.string().uuid(), parentEventId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't undo that." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_untick_bulk", { p_parent_event_id: parsed.data.parentEventId });
  if (error) return { ok: false, message: "Couldn't undo that — check your signal and try again." };

  const r = (data ?? {}) as RpcShape;
  if (r.ok) {
    const service = createServiceClient();
    if (service) {
      const workOrderId = parsed.data.workOrderId;
      after(() => draftUpdateForWorkOrder(service, workOrderId).catch(() => {}));
    }
    revalidatePath("/portal/jobs");
    revalidatePath("/pc");
    return { ok: true, count: r.count ?? 0, surfaceIds: r.surface_ids ?? [] };
  }
  if (r.error === "too_late") return { ok: false, message: "Too late to undo — tap the rooms back By room instead." };
  if (r.error === "not_yours") return { ok: false, message: "Only the person who tapped can undo it." };
  return { ok: false, message: "Couldn't undo that." };
}
