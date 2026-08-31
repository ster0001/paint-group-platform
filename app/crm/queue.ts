import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { buildWorkQueue, type WorkQueue } from "@/lib/crm/work-queue";

/**
 * The single per-request door to the evaluator. The layout's badge, the Today
 * page and the badge route all come through here, so within one render pass
 * the queue is computed once — the acceptance line "Today, the badge, and any
 * filtered view all call the same evaluator", made structural.
 *
 * 2A.10 will add the count-query fast path for the badge at volume; until
 * then the full build IS cheap (every source bounded and indexed).
 */
export const getWorkQueue = cache(async (): Promise<WorkQueue> => {
  const supabase = await createClient();
  return buildWorkQueue(supabase);
});
