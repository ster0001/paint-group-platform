import { z } from "zod";

// Presentation content shapes — validated on save (Settings) and on render.
// A presentation is an ordered set of typed blocks injected into the estimate view.

export const BLOCK_KINDS = ["video", "before_after_gallery", "review_set", "capability_panel"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

// ---- video ----------------------------------------------------------------
export const videoEntry = z.object({
  url: z.string().optional().default(""),          // hosted (Vimeo/Mux) — alternative to storage_path
  storage_path: z.string().optional().default(""), // presentation-media path
  poster_path: z.string().optional().default(""),
  caption_title: z.string().default(""),
  caption_sub: z.string().default(""),
  duration_label: z.string().default(""),
});
export const videoContent = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  videos: z.array(videoEntry).default([]),
});

// ---- before / after gallery -----------------------------------------------
export const baPair = z.object({
  before_path: z.string().default(""),
  after_path: z.string().default(""),
  info_title: z.string().default(""),
  info_subtitle: z.string().default(""),
});
export const beforeAfterContent = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  pairs: z.array(baPair).default([]),
});

// ---- review set (exactly four fields per review; up to 3 shown) -----------
export const review = z.object({
  body: z.string().default(""),            // supports ==highlight== spans
  reviewer_title: z.string().default(""),
  company_name: z.string().default(""),
  source: z.string().default(""),
});
export const reviewSetContent = z.object({
  title: z.string().default(""),
  reviews: z.array(review).default([]),
  footer_line: z.string().default(""),
});

// ---- capability panel ------------------------------------------------------
export const capabilityAttachment = z.object({
  label: z.string().default(""),
  doc_path: z.string().default(""), // presentation-docs path (PDF)
});
export const capabilityCard = z.object({
  icon: z.string().default(""),
  heading: z.string().default(""),
  body: z.string().default(""),
  attachment: capabilityAttachment.optional(),
});
export const capabilityContent = z.object({
  title: z.string().default(""),
  cards: z.array(capabilityCard).default([]),
});

// Parse a block's content by kind (throws on invalid; returns typed content).
export function parseBlockContent(kind: BlockKind, content: unknown) {
  switch (kind) {
    case "video": return videoContent.parse(content);
    case "before_after_gallery": return beforeAfterContent.parse(content);
    case "review_set": return reviewSetContent.parse(content);
    case "capability_panel": return capabilityContent.parse(content);
  }
}

// Whether a block has enough content to render (never render a hollow block).
export function blockHasContent(kind: BlockKind, content: unknown): boolean {
  const r = safeParse(kind, content);
  if (!r) return false;
  if (kind === "video") return (r as z.infer<typeof videoContent>).videos.some((v) => v.url || v.storage_path || v.poster_path);
  if (kind === "before_after_gallery") return (r as z.infer<typeof beforeAfterContent>).pairs.some((p) => p.before_path && p.after_path);
  if (kind === "review_set") return validReviews((r as z.infer<typeof reviewSetContent>).reviews).length > 0;
  if (kind === "capability_panel") return (r as z.infer<typeof capabilityContent>).cards.some((c) => c.heading || c.body);
  return false;
}

export function safeParse(kind: BlockKind, content: unknown) {
  try { return parseBlockContent(kind, content); } catch { return null; }
}

// A review renders only when all four fields are present.
export function validReviews(reviews: z.infer<typeof review>[]) {
  return reviews.filter((r) => r.body.trim() && r.reviewer_title.trim() && r.company_name.trim() && r.source.trim()).slice(0, 3);
}

export type VideoContent = z.infer<typeof videoContent>;
export type BeforeAfterContent = z.infer<typeof beforeAfterContent>;
export type ReviewSetContent = z.infer<typeof reviewSetContent>;
export type CapabilityContent = z.infer<typeof capabilityContent>;
