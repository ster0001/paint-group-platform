import type { GalleryKind } from "./schema";

/**
 * Paint Home SEO foundations (26 Nov 2026) — the words on a job photo for
 * someone who cannot see it. A hand-written caption leads ("Living room");
 * without one the stage and the photo's place in the set stand in, so no two
 * photos on a page read the same. Every description names the job and the
 * suburb. Pure.
 */
const STAGE: Record<GalleryKind, string> = { before: "before painting", during: "during painting", after: "after painting" };

export function galleryAlt(job: { title: string; suburb: string }, item: { caption: string; kind: GalleryKind }, index: number, total: number): string {
  const where = [job.title.trim(), job.suburb.trim()].filter(Boolean).join(" in ");
  const caption = item.caption.trim().replace(/[.\s]+$/, "");
  if (caption) return `${caption}, ${STAGE[item.kind]}: ${where}`;
  return `${where}, ${STAGE[item.kind]}${total > 1 ? ` (photo ${index + 1} of ${total})` : ""}`;
}
