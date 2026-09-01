import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkListingUrl, checkPlanImageUrl, findFloorplanImages } from "@/lib/extract/listing";
import { makeIncomingPath } from "@/lib/uploads/incoming";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/listing-plan  { url }
 *
 * Tom, 31 Aug: an interior job should be able to READ THE FLOORPLAN off the
 * real-estate listing, not just cross-check its words. This route fetches the
 * listing (same allow-list as the cross-check), finds the floorplan image the
 * portal marks apart from the gallery, downloads it, and STAGES it into the
 * caller's own upload prefix. The client then hands the staged path to
 * /api/extract/floorplan exactly as if the customer had uploaded the file —
 * one ingest pipeline, magic-byte checks and all.
 *
 * Honest failure is part of the design: realestate.com.au blocks automated
 * access (verified 20 Aug — 429 to our user agent), so the error tells the
 * customer to screenshot the plan and upload it instead. NOTE the 20 Aug
 * ruling ("no agency photos — customer's own photos only") stands: this
 * fetches the FLOORPLAN only, for measurement; gallery photos are never
 * touched.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_PLAN_IMAGE_BYTES = 10 * 1024 * 1024;

const bodySchema = z.object({ url: z.string().min(8).max(500) });

const UPLOAD_INSTEAD =
  "open the listing yourself, save or screenshot the floorplan, and upload it here — takes about twenty seconds.";

function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return fail(403, "Only Paint Group staff can do this.");
  const user = actor.user;
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return fail(503, "The estimate wizard isn't available just now.");
    db = svc;
    // The same visitor budget as every other ingest door.
    const { count } = await db.from("estimate_sources")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);
    if ((count ?? 0) >= 30) {
      return fail(429, "That's plenty of pages for one estimate — talk to us and we'll take it from here.");
    }
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Send a listing URL.");
  const check = checkListingUrl(parsed.data.url);
  if (!check.ok) return fail(400, check.message);

  let html: string;
  try {
    const res = await fetch(check.url, {
      redirect: "error",
      headers: { "user-agent": "PaintGroupEstimator/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return fail(502, `That site wouldn't let us read the listing (${res.status}) — ${UPLOAD_INSTEAD}`);
    }
    html = (await res.text()).slice(0, 3_000_000);
  } catch (e) {
    reportError(e, { where: "extract.listingPlanFetch", bestEffort: true, extra: { host: check.url.hostname } });
    return fail(502, `Couldn't open that listing — some sites block automated access. Instead, ${UPLOAD_INSTEAD}`);
  }

  const candidates = findFloorplanImages(html);
  if (candidates.length === 0) {
    return fail(404, `We couldn't find a floorplan on that listing. If it has one, ${UPLOAD_INSTEAD}`);
  }

  // Try the candidates in order; the first real image wins.
  for (const candidate of candidates) {
    const img = checkPlanImageUrl(candidate);
    if (!img.ok) continue;
    try {
      const res = await fetch(img.url, {
        redirect: "follow",
        headers: { "user-agent": "PaintGroupEstimator/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("image/")) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_PLAN_IMAGE_BYTES) continue;

      // Stage into the caller's OWN prefix — /api/extract/floorplan then
      // validates the bytes and ingests, the same as any uploaded plan.
      const path = makeIncomingPath(user.id, 0, `${Date.now()}-${randomUUID().slice(0, 8)}`);
      const up = await db.storage.from("estimate-sources").upload(path, bytes, {
        contentType: type.split(";")[0],
        upsert: false,
      });
      if (up.error) {
        reportError(up.error, { where: "extract.listingPlanStage", extra: { path } });
        continue;
      }
      return NextResponse.json({ path, name: "listing-floorplan" });
    } catch {
      continue; // the next candidate might still work
    }
  }

  return fail(502, `The listing's floorplan image couldn't be downloaded. Instead, ${UPLOAD_INSTEAD}`);
}
