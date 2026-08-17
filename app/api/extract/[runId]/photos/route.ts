import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normaliseUpload } from "@/lib/extract/normalise";
import { readPropertyPhoto, mergePhotoFindings, PHOTO_PROMPT_VERSION, type PhotoRead } from "@/lib/extract/photos";
import { extractionSchema } from "@/lib/extract/schema";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/:runId/photos
 *
 * Property photos, folded into a plan reading that already exists.
 *
 * This is what answers the three questions a floorplan physically cannot:
 * door style, window style and whether there is a cornice. Until a photo
 * settles them, those lines are NOT generated — so adding photos here is what
 * turns "3 doors, type unknown" into three priced doors at the right rate.
 *
 * A photo is only allowed to CHANGE an unknown into a known. It never
 * overrides a dimension read off the plan, and a low-confidence or disagreeing
 * answer leaves the unknown in place for the estimator.
 */

export const runtime = "nodejs";
export const maxDuration = 240;

const MAX_PHOTOS = 12;
const paramsSchema = z.object({ runId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  const { runId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });

  const { data: run } = await supabase
    .from("extraction_runs")
    .select("id, raw_output, estimate_source_id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (!run.raw_output) {
    return NextResponse.json({ error: "Read the plan first, then add photos.", code: "not_read" }, { status: 409 });
  }

  const reading = extractionSchema.safeParse(run.raw_output);
  if (!reading.success) return NextResponse.json({ error: "The stored reading is unusable." }, { status: 422 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send photos as multipart/form-data." }, { status: 400 }); }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No photo was attached." }, { status: 400 });
  if (files.length > MAX_PHOTOS) return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos at a time.` }, { status: 400 });

  const reads: PhotoRead[] = [];
  const perPhoto: Array<Record<string, unknown>> = [];
  let costCents = 0;

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = normaliseUpload(bytes, file.type, file.name);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
    if (check.kind === "pdf") return NextResponse.json({ error: "Photos only here — a PDF plan goes through the plan upload." }, { status: 400 });

    // Keep the photo: it is evidence for a decision that changes the price.
    const path = `runs/${runId}/photos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${check.kind}`;
    const up = await supabase.storage.from("estimate-sources").upload(path, bytes, { contentType: check.mime });
    if (up.error) reportError(up.error, { where: "extract.photoUpload", bestEffort: true });

    const result = await readPropertyPhoto(bytes);
    if (!result.ok) {
      reportError(result.message, { where: "extract.photoRead", extra: { runId } });
      perPhoto.push({ file: file.name, error: result.message });
      continue;
    }
    costCents += result.costCents;
    reads.push(result.read);
    perPhoto.push({
      file: file.name,
      shows: result.read.shows,
      room: result.read.room_guess,
      doors: result.read.doors,
      windows: result.read.windows,
      cornice: result.read.cornice,
      ceilingHeight: result.read.ceiling_height,
    });

    await supabase.from("estimate_sources").insert({
      kind: "exterior_photo",
      storage_path: path,
      mime_type: check.mime,
      byte_size: check.bytes,
      page_class: "photo",
      page_class_confidence: 0.95,
      created_by: user.id,
    });
  }

  if (reads.length === 0) {
    return NextResponse.json({ error: "None of those photos could be read.", perPhoto }, { status: 502 });
  }

  // ---- fold the findings in, but only where they are confident -------------
  const merged = mergePhotoFindings(reads);

  const updated = {
    ...reading.data,
    ceiling_height_m: reading.data.ceiling_height_m ?? merged.ceilingHeightM,
    rooms: reading.data.rooms.map((r) => ({
      ...r,
      // A photo NEVER overrides what the plan printed — it only fills unknowns.
      cornice: r.cornice === "unknown" ? merged.cornice : r.cornice,
      doors: r.doors.map((d) => (d.style === "unknown" && merged.doorStyle !== "unknown"
        ? { ...d, style: merged.doorStyle, style_confidence: 0.75 } : d)),
      windows: r.windows.map((w) => (w.style === "unknown" && merged.windowStyle !== "unknown"
        ? { ...w, style: merged.windowStyle, style_confidence: 0.75 } : w)),
    })),
  };

  const revalidated = extractionSchema.safeParse(updated);
  if (!revalidated.success) return NextResponse.json({ error: "Merging the photos produced an unusable reading." }, { status: 500 });

  await supabase.from("extraction_runs").update({
    raw_output: revalidated.data,
    prompt_version: PHOTO_PROMPT_VERSION,
    cost_cents: costCents,
  }).eq("id", runId);

  return NextResponse.json({
    photosRead: reads.length,
    applied: {
      doorStyle: merged.doorStyle,
      windowStyle: merged.windowStyle,
      cornice: merged.cornice,
      ceilingHeightM: merged.ceilingHeightM,
    },
    /** Anything still unknown stays a question for the estimator. */
    stillUnknown: [
      merged.doorStyle === "unknown" ? "door style" : null,
      merged.windowStyle === "unknown" ? "window style" : null,
      merged.cornice === "unknown" ? "cornice" : null,
      merged.ceilingHeightM == null ? "ceiling height" : null,
    ].filter(Boolean),
    perPhoto,
    costCents,
  });
}
