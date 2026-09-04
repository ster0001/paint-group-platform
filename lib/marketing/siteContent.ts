import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { mediaPath } from "@/lib/showcase/schema";

/**
 * Website content Tom edits in Settings → Company → Website (5 Sep 2026):
 * the painter cards (⚑9.3 — entering a painter here IS the decision that
 * they may be named), the two photos on the "No surprises" variation card,
 * and the two photos that slide into the phone during the progress story.
 * One settings row, key `website_content`; photos are paths in the public
 * showcase-media bucket under `site/`. Public pages read it server-side
 * with the service client (same as getCompanyContact) — ISR, revalidated
 * by the save action.
 */
export const WEBSITE_CONTENT_KEY = "website_content";

export const painterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  specialty: z.string().trim().max(80).default(""),
  /** `with Paint Group since YYYY` — specialty + start year only; no ratings, no job counts (brief §4.9). */
  since: z.string().trim().regex(/^(20\d{2}|19\d{2})?$/, "A four-digit year, e.g. 2024.").default(""),
  quote: z.string().trim().max(200).default(""),
  photoPath: mediaPath.nullable().default(null),
});
export type Painter = z.infer<typeof painterSchema>;

export const websiteContentSchema = z.object({
  painters: z.array(painterSchema).max(3).default([]),
  /** §4.5 panel 0 — the two photos beside "Replace 2.4 m of rotten fascia board…". */
  promisePhotos: z.array(mediaPath).max(2).default([]),
  /** §4.7 beat 3 — "Prep · floors covered", "Living room · masked up". */
  storyPhotos: z.array(mediaPath).max(2).default([]),
});
export type WebsiteContent = z.infer<typeof websiteContentSchema>;

export const EMPTY_WEBSITE_CONTENT: WebsiteContent = { painters: [], promisePhotos: [], storyPhotos: [] };

/** Tolerant: an older or partial row still renders; garbage renders the defaults. */
export function parseWebsiteContent(value: unknown): WebsiteContent {
  const r = websiteContentSchema.safeParse(value ?? {});
  return r.success ? r.data : EMPTY_WEBSITE_CONTENT;
}

export async function getWebsiteContent(): Promise<WebsiteContent> {
  const svc = createServiceClient();
  if (!svc) return EMPTY_WEBSITE_CONTENT;
  const { data } = await svc.from("settings").select("value").eq("key", WEBSITE_CONTENT_KEY).maybeSingle();
  return parseWebsiteContent(data?.value);
}

/**
 * The nav logo: Settings → Company details → logo 1 (the light-on-dark one —
 * the marketing nav is ink, so logo 2, the black-on-white version with the
 * tagline, would vanish there). Empty string = the monospace wordmark.
 */
export async function getSiteLogo(): Promise<string> {
  const svc = createServiceClient();
  if (!svc) return "";
  const { data } = await svc.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const v = (data?.value ?? {}) as { logoUrl?: string };
  return (v.logoUrl ?? "").trim();
}
