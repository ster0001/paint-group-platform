import { createClient } from "@supabase/supabase-js";
import type { Audience } from "./audience";
import { mergeCopy } from "./copy";
import type { SiteCopy } from "./copy/schema";
import type { ReviewTag } from "./reviewTags";

/**
 * Session 8 §3 — the one reader for site_content. Cookie-less anon client
 * (public select), like the showcase reads: a public page sees exactly what
 * the public sees. Rows lay over the defaults in lib/marketing/copy, so a
 * fresh environment renders before the migration runs. ISR: the pages
 * revalidate every 60 s and the save action revalidates them at once.
 */
function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // `cache: "no-store"` on the underlying fetch: an ISR page must read the
  // table fresh each time it regenerates, never a Data Cache copy — a save
  // in Settings revalidates the page and expects the new rows to show.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

export async function getSiteCopy(audience: Audience): Promise<SiteCopy> {
  const db = publicClient();
  if (!db) return mergeCopy(audience, []);
  const { data } = await db.from("site_content").select("section, key, value").eq("audience", audience).order("sort").limit(1000);
  return mergeCopy(audience, (data ?? []) as Array<{ section: string; key: string; value: string }>);
}

/** The confirmed review tags (§5) — public rows, no PII beyond the author's display name Google already shows. */
export async function getReviewTags(): Promise<ReviewTag[]> {
  const db = publicClient();
  if (!db) return [];
  const { data } = await db.from("review_tags").select("review_key, audience, audience_suggested").limit(500);
  return (data ?? []) as ReviewTag[];
}
