"use server";

import { z } from "zod";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { loadProgressContextForEstimate } from "@/lib/progress-preview/context";
import { buildProgressPreview, type ProgressPreview } from "@/lib/progress-preview/build";
import { sampleTimeline, SAMPLE_PROJECT } from "@/lib/progress-preview/timelineItems";
import JobTimeline from "@/app/account/(portal)/JobTimeline";

/**
 * The live-progress phone for the BUILDER's customer preview (Tom, 20 Sep).
 *
 * The customer page renders ProgressSection on the server from the sent
 * snapshot. The builder is a client component showing a doc it builds live,
 * so it cannot render the phone's feed (the portal's JobTimeline, a Server
 * Component) itself. This action is the same render, on demand: staff only,
 * input validated, the estimate's own context (account type → messaging set,
 * demo painter, references) looked up by id. It returns the preview DATA and
 * the server-rendered FEED; the builder renders ProgressPhone itself, because
 * a client component that only ever arrives inside an action's return value
 * is not in the route's client manifest and cannot be resolved. (PhotoGrid,
 * inside the feed, is registered by QuoteBuilder for the same reason.)
 */
export type ProgressPreviewRender = { preview: ProgressPreview; feed: ReactNode };
const input = z.object({
  estimateId: z.string().uuid(),
  contactName: z.string().max(200),
  jobAddress: z.string().max(400),
  areas: z.array(z.object({ title: z.string().max(200), photos: z.array(z.string().url().max(600)).max(40) })).max(200),
  paints: z.array(z.object({
    name: z.string().max(200), brand: z.string().max(100), category: z.string().max(100), role: z.string().max(100), isPrep: z.boolean(),
  })).max(100),
});

export async function renderProgressPreviewAction(raw: unknown): Promise<ProgressPreviewRender | null> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return null;

  const ctx = await loadProgressContextForEstimate(parsed.data.estimateId);
  if (!ctx.eligible) return null;
  const preview = buildProgressPreview(
    { ...parsed.data, organisationName: ctx.organisationName, references: ctx.references },
    ctx.set,
    ctx.demoPainter,
  );
  if (!preview) return null;
  const sample = sampleTimeline(preview);
  return { preview, feed: <JobTimeline project={SAMPLE_PROJECT} companyPhone="" sample={sample} /> };
}
