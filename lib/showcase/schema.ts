import { z } from "zod";

/**
 * showcase_jobs — the one shape for the editor's input, the server action's
 * validation and the rows the public pages read (homepage brief §4.4a).
 * The database mirrors every rule here as a constraint; this is the layer
 * that answers in plain English.
 */

export const JOB_TYPES = ["interior", "exterior", "commercial", "heritage", "body_corporate"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABEL: Record<JobType, string> = {
  interior: "Interior",
  exterior: "Exterior",
  commercial: "Commercial",
  heritage: "Heritage",
  body_corporate: "Body corporate",
};

export const PROPERTY_TYPES = ["home", "business"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const GALLERY_KINDS = ["before", "during", "after"] as const;
export type GalleryKind = (typeof GALLERY_KINDS)[number];

/** A storage object path in the showcase-media bucket — conservative characters only. */
export const mediaPath = z.string().regex(/^[A-Za-z0-9/._-]{1,300}$/, "That photo reference isn't valid.");

export const whatWeDidRowSchema = z.object({
  area: z.string().trim().min(1, "Name the area.").max(80),
  work: z.string().trim().min(1, "Say what was done.").max(200),
});
export const colourRowSchema = z.object({
  surface: z.string().trim().max(80).default(""),
  brand: z.string().trim().max(60).default(""),
  product: z.string().trim().max(80).default(""),
  colour: z.string().trim().min(1, "Name the colour.").max(80),
});
export const galleryItemSchema = z.object({
  path: mediaPath,
  caption: z.string().trim().max(160).default(""),
  kind: z.enum(GALLERY_KINDS),
});

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the month it was completed.");

/** What the editor sends. `id` absent = create. `slug` absent = derived from title + suburb. */
export const showcaseJobInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    slug: z.string().trim().toLowerCase().min(3).max(80).regex(SLUG_RE, "Slugs are lower-case words joined by hyphens.").optional(),
    title: z.string().trim().min(1, "Give the job a title.").max(120),
    job_type: z.enum(JOB_TYPES),
    property_type: z.enum(PROPERTY_TYPES),
    suburb: z.string().trim().min(1, "Which suburb?").max(80),
    completed_on: isoDate.nullable().default(null),
    days_on_site: z.number().int().min(1).max(365).nullable().default(null),
    price_low_cents: z.number().int().min(0).nullable().default(null),
    price_high_cents: z.number().int().min(0).nullable().default(null),
    scope_line: z.string().trim().max(90, "The scope line is one line — 90 characters at most.").default(""),
    summary: z.string().trim().max(2000).default(""),
    what_we_did: z.array(whatWeDidRowSchema).max(40).default([]),
    colours: z.array(colourRowSchema).max(40).default([]),
    condition_notes: z.string().trim().max(2000).default(""),
    hero_path: mediaPath.nullable().default(null),
    gallery: z.array(galleryItemSchema).max(60).default([]),
    estimate_id: z.string().uuid().nullable().default(null),
    review_quote: z.string().trim().max(600).nullable().default(null),
    review_name: z.string().trim().max(80).nullable().default(null),
    /** A YouTube or Vimeo link (Tom, 5 Sep) — validated as one by the action. */
    video_url: z.string().trim().url().max(300).nullable().default(null),
    video_caption: z.string().trim().max(160).nullable().default(null),
    video_transcript: z.string().trim().max(20000).nullable().default(null),
    video_poster_path: mediaPath.nullable().default(null),
    featured_rank: z.number().int().min(1).max(3).nullable().default(null),
    consent_confirmed: z.boolean().default(false),
    published: z.boolean().default(false),
    /** Editor: "yes, take rank N off the job that has it" (§4.4b). */
    displace_featured: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.price_low_cents != null && v.price_high_cents != null && v.price_low_cents > v.price_high_cents) {
      ctx.addIssue({ code: "custom", path: ["price_high_cents"], message: "The top of the range can't be below the bottom." });
    }
    if ((v.price_low_cents == null) !== (v.price_high_cents == null)) {
      ctx.addIssue({ code: "custom", path: ["price_low_cents"], message: "A price range needs both ends." });
    }
  });

export type ShowcaseJobInput = z.infer<typeof showcaseJobInputSchema>;

/** A stored row, as the public pages and the editor read it. */
export const showcaseJobRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  job_type: z.enum(JOB_TYPES),
  property_type: z.enum(PROPERTY_TYPES),
  suburb: z.string(),
  completed_on: z.string().nullable(),
  days_on_site: z.number().int().nullable(),
  price_low_cents: z.number().int().nullable(),
  price_high_cents: z.number().int().nullable(),
  scope_line: z.string(),
  summary: z.string(),
  what_we_did: z.array(whatWeDidRowSchema).catch([]),
  colours: z.array(colourRowSchema).catch([]),
  condition_notes: z.string(),
  hero_path: z.string().nullable(),
  gallery: z.array(galleryItemSchema).catch([]),
  estimate_id: z.string().uuid().nullable(),
  review_quote: z.string().nullable(),
  review_name: z.string().nullable(),
  video_url: z.string().nullable().default(null),
  video_caption: z.string().nullable().default(null),
  video_transcript: z.string().nullable().default(null),
  video_poster_path: z.string().nullable().default(null),
  featured_rank: z.number().int().nullable(),
  consent_confirmed: z.boolean().default(false),
  published: z.boolean(),
  published_at: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
});
export type ShowcaseJob = z.infer<typeof showcaseJobRowSchema>;

/** The columns any reader selects — never `*`, so tenant plumbing stays out of pages. */
export const SHOWCASE_COLUMNS =
  "id, slug, title, job_type, property_type, suburb, completed_on, days_on_site, price_low_cents, price_high_cents, scope_line, summary, what_we_did, colours, condition_notes, hero_path, gallery, estimate_id, review_quote, review_name, video_url, video_caption, video_transcript, video_poster_path, featured_rank, consent_confirmed, published, published_at, created_at, updated_at";

/**
 * §4.4b — publish is blocked with a checklist, in plain English. Mirrors the
 * showcase_jobs_publish_ready constraint exactly; an empty list = may publish.
 */
export function publishChecklist(job: {
  hero_path: string | null;
  price_low_cents: number | null;
  price_high_cents: number | null;
  completed_on: string | null;
  consent_confirmed: boolean;
}): string[] {
  const out: string[] = [];
  if (!job.hero_path) out.push("Needs a hero photo");
  if (job.price_low_cents == null || job.price_high_cents == null) out.push("Needs a price range");
  if (!job.completed_on) out.push("Needs the month it was completed");
  if (!job.consent_confirmed) out.push("Photo consent not confirmed");
  return out;
}

/** Zod issues → one plain sentence each, for inline display. */
export function plainIssues(error: z.ZodError): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    const label = FIELD_LABEL[field] ?? field;
    const msg = issue.message.startsWith("Invalid") || issue.message.startsWith("Too") || issue.message.startsWith("Expected")
      ? `${label ? `${label}: ` : ""}check this value.`
      : issue.message;
    if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
  }
  return out;
}

const FIELD_LABEL: Record<string, string> = {
  title: "Title", slug: "Slug", job_type: "Job type", property_type: "Property type", suburb: "Suburb",
  completed_on: "Completed on", days_on_site: "Days on site", price_low_cents: "Price range", price_high_cents: "Price range",
  scope_line: "Scope line", summary: "Summary", what_we_did: "What we did", colours: "Colours", condition_notes: "Condition notes",
  hero_path: "Hero photo", gallery: "Gallery", estimate_id: "Linked estimate", review_quote: "Customer line", review_name: "Customer name",
  featured_rank: "Featured rank",
};
