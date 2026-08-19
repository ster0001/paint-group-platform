import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseUpload } from "@/lib/extract/normalise";
import { convertHeicToJpeg } from "@/lib/extract/heic";
import { readPropertyPhoto, mergePhotoFindings, PHOTO_PROMPT_VERSION, type PhotoPurpose, type PhotoRead } from "@/lib/extract/photos";
import { extractionSchema } from "@/lib/extract/schema";
import { isOwnIncomingPath } from "@/lib/uploads/incoming";
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
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  const { data: run } = await db
    .from("extraction_runs")
    .select("id, raw_output, estimate_source_id, created_by")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (actor.kind === "customer" && (run as { created_by?: string | null }).created_by !== actor.user.id) {
    return NextResponse.json({ error: "No such run." }, { status: 404 });
  }
  if (!run.raw_output) {
    return NextResponse.json({ error: "Read the plan first, then add photos.", code: "not_read" }, { status: 409 });
  }

  const reading = extractionSchema.safeParse(run.raw_output);
  if (!reading.success) return NextResponse.json({ error: "The stored reading is unusable." }, { status: 422 });

  // A7: which question this batch answers. "damage" puts defects first —
  // the generic ask was returning empty defect lists for photos customers
  // took precisely to show us damage.
  const purpose: PhotoPurpose =
    new URL(request.url).searchParams.get("purpose") === "damage" ? "damage" : "property";

  // A3/A7: photos arrive either as multipart (small batches) or as staged
  // storage paths (the wizard stages via signed URLs — a batch of iPhone
  // photos blows the serverless body cap as multipart).
  const inputs: Array<{ bytes: Uint8Array; declaredMime?: string; name: string; stagedPath?: string }> = [];
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const staged = z.object({
      uploads: z.array(z.object({
        path: z.string().min(1).max(400),
        name: z.string().max(200).default("photo"),
      })).min(1).max(MAX_PHOTOS),
    }).safeParse(await request.json().catch(() => null));
    if (!staged.success) return NextResponse.json({ error: "Send the staged photo paths." }, { status: 400 });
    for (const u of staged.data.uploads) {
      if (!isOwnIncomingPath(u.path, actor.user.id)) return NextResponse.json({ error: "That upload isn't yours to attach." }, { status: 403 });
      const { data, error } = await db.storage.from("estimate-sources").download(u.path);
      if (error || !data) {
        return NextResponse.json({ error: `"${u.name}" didn't finish uploading — please try that photo again.` }, { status: 400 });
      }
      inputs.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: u.name, stagedPath: u.path });
    }
  } else {
    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send photos as multipart/form-data." }, { status: 400 }); }
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No photo was attached." }, { status: 400 });
    if (files.length > MAX_PHOTOS) return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos at a time.` }, { status: 400 });
    for (const f of files) inputs.push({ bytes: new Uint8Array(await f.arrayBuffer()), declaredMime: f.type, name: f.name });
  }

  const reads: PhotoRead[] = [];
  const perPhoto: Array<Record<string, unknown>> = [];
  const stagedToClean: string[] = [];
  let costCents = 0;

  for (const file of inputs) {
    if (file.stagedPath) stagedToClean.push(file.stagedPath);
    // A7: one bad photo skips, it no longer aborts the whole batch.
    const check = normaliseUpload(file.bytes, file.declaredMime, file.name);
    if (!check.ok) { perPhoto.push({ file: file.name, error: check.message }); continue; }
    if (check.kind === "pdf") { perPhoto.push({ file: file.name, error: "Photos only here — a PDF plan goes through the plan upload." }); continue; }

    // iPhone HEIC: the reader only takes JPEG/PNG/WEBP — convert first (A3's
    // converter), keep the original bytes as the stored evidence.
    let readBytes = file.bytes;
    if (check.kind === "heic") {
      const converted = await convertHeicToJpeg(file.bytes);
      if (!converted.ok) { perPhoto.push({ file: file.name, error: converted.message }); continue; }
      readBytes = converted.jpeg;
    }

    // Keep the photo: it is evidence for a decision that changes the price.
    const path = `runs/${runId}/photos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${check.kind}`;
    const up = await db.storage.from("estimate-sources").upload(path, file.bytes, { contentType: check.mime });
    if (up.error) reportError(up.error, { where: "extract.photoUpload", bestEffort: true });

    const result = await readPropertyPhoto(readBytes, purpose);
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
      defects: result.read.defects.length,
    });

    await db.from("estimate_sources").insert({
      // Damage photos are defect evidence, not exterior shots (A7).
      kind: purpose === "damage" ? "defect_photo" : "exterior_photo",
      storage_path: path,
      mime_type: check.mime,
      byte_size: check.bytes,
      page_class: "photo",
      page_class_confidence: 0.95,
      created_by: actor.user.id,
    });
  }

  if (stagedToClean.length) {
    await db.storage.from("estimate-sources").remove(stagedToClean).then(() => null, () => null);
  }

  if (reads.length === 0) {
    return NextResponse.json({ error: "None of those photos could be read.", perPhoto }, { status: 502 });
  }

  // ---- fold the findings in, but only where they are confident -------------
  const merged = mergePhotoFindings(reads);

  const updated = {
    ...reading.data,
    // Defects accumulate across photo batches; re-running the same batch
    // replaces rather than doubles because merge already dedupes by
    // type+room within a batch and we key existing ones the same way.
    defect_observations: [
      ...(reading.data.defect_observations ?? []).filter(
        (e) => !merged.defects.some((d) => d.type === e.type && (d.room_hint ?? "") === (e.room_hint ?? "")),
      ),
      ...merged.defects,
    ],
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

  await db.from("extraction_runs").update({
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
      defects: merged.defects.map((d) => `${d.type} sev${d.severity}${d.room_hint ? ` (${d.room_hint})` : ""}`),
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
