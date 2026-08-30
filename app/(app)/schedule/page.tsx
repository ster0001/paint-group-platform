import { permanentRedirect } from "next/navigation";

/**
 * The timeline moved into the Projects console — scheduling is the first step
 * of the job workflow, not a separate corner of the app. Old links, bookmarks
 * and specs still land somewhere real rather than on a 404 — and the window
 * params ride along, so a deep link to a date range still opens on it.
 */
export default async function ScheduleMoved({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.from) qs.set("from", sp.from);
  if (sp.days) qs.set("days", sp.days);
  permanentRedirect(`/pc/schedule${qs.size ? `?${qs}` : ""}`);
}
