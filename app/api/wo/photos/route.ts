import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sniffKind, sniffVideoKind, videoExtensionFor, MAX_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { isVideoPath } from "@/lib/workorder/photos";
import { reportError } from "@/lib/monitoring/report";
import { stagedHeadBytes } from "@/lib/workorder/stagedBytes";

/**
 * Work-order site photos — the before/progress/QA/completion record, plus the
 * 'reference' photos the OFFICE attaches for the painter (Tom, 23 Sep 2026).
 *
 * Two stages, the remediated upload path: POST hands out a signed upload URL
 * into the private wo-photos bucket, the phone PUTs the bytes straight to
 * storage (a 4 MB serverless body limit will not carry an iPhone photo), then
 * PUT here ingests it. The signature is read from the STAGED BYTES on ingest —
 * a signed URL is permission to store bytes, never a statement of what they
 * are — and only then does wo_record_photo write the row.
 *
 * A photo that fails the sniff is deleted from storage rather than left behind
 * as an orphan; the loop already carries one lesson about orphaned photo rows.
 *
 * Videos (Tom, 26 Sep 2026): the painter's Variations and Photos & notes cards
 * take a video too. The sign step is told the declared type and names the
 * object with a video extension — that extension is how every reader tells a
 * video from a photo (lib/workorder/photos.ts isVideoPath). The ingest reads
 * only the first bytes of the staged object (a Range request — a 100 MB clip
 * is never pulled through this function) and refuses bytes that disagree with
 * the name. Playback is a signed URL straight from storage, never proxied.
 */

export const runtime = "nodejs";

const KINDS = ["before", "progress", "qa", "completion", "variation", "reference", "callback"] as const;

const signBody = z.object({
  workOrderId: z.string().uuid(),
  size: z.number().int().positive().max(MAX_VIDEO_UPLOAD_BYTES),
  /** The file's declared type; a video type names the object with its extension. */
  contentType: z.string().max(80).optional(),
}).superRefine((v, ctx) => {
  const video = videoExtensionFor(v.contentType) !== null;
  if (!video && v.size > MAX_UPLOAD_BYTES) {
    ctx.addIssue({ code: "custom", message: "photo too large", path: ["size"] });
  }
});

const ingestBody = z.object({
  workOrderId: z.string().uuid(),
  path: z.string().min(1).max(300),
  kind: z.enum(KINDS),
  surfaceId: z.string().uuid().nullish(),
  area: z.string().max(120).default(""),
  caption: z.string().max(300).default(""),
  /** Attach straight onto a variation (the revision builder's uploader). */
  variationId: z.string().uuid().nullish(),
});

const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status });

/** Photos live under the work order they belong to, one flat level; a video carries its extension. */
function photoPath(workOrderId: string, videoExt: string | null): string {
  return `wo/${workOrderId}/${Date.now()}-${randomUUID().slice(0, 8)}${videoExt ? `.${videoExt}` : ""}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(403, "Sign in to add photos.");

  const parsed = signBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((i) => i.path[0] === "size");
    return fail(400, tooBig
      ? `That file is too big — photos up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, videos up to ${MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024} MB.`
      : "Tell us which job the photo belongs to.");
  }

  // The membership question, asked of the database: the lead (contractor_id)
  // or anyone assigned to the job (employed crew, 20270159). SECURITY DEFINER,
  // so it answers for an employee who has no work_orders read at all
  // (20270153); staff read every job. A refused call is a refused upload.
  const { data: onJob, error: onJobError } = await supabase
    .rpc("wo_is_my_job_as_contractor", { p_wo_id: parsed.data.workOrderId });
  if (onJobError) reportError(onJobError, { where: "wo.photos.ownership", extra: { workOrderId: parsed.data.workOrderId } });
  const { data: staffRow } = onJob === true ? { data: null } : await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (onJob !== true && (staffRow as { role?: string } | null)?.role !== "staff") return fail(404, "That job isn't yours.");

  const path = photoPath(parsed.data.workOrderId, videoExtensionFor(parsed.data.contentType));
  const { data, error } = await supabase.storage.from("wo-photos").createSignedUploadUrl(path);
  if (error || !data) {
    reportError(error, { where: "wo.photos.signedUploadUrl", extra: { path } });
    return fail(502, "Couldn't get the upload ready — try again in a moment.");
  }
  return NextResponse.json({ path: data.path, token: data.token });
}

export async function PUT(request: Request) {
  // Tom, 30 Sep: uploads sat on "Uploading…" with the ingest never answering.
  // Every phase is timed; anything over five seconds is logged with the split
  // so the slow step is named in the server log, not guessed at.
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  let last = t0;
  const mark = (k: string) => { const now = Date.now(); marks[k] = now - last; last = now; };
  const done = (res: NextResponse) => {
    const total = Date.now() - t0;
    if (total > 5_000) console.warn(`[wo.photos.ingest] slow ${total} ms`, JSON.stringify(marks));
    return res;
  };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(403, "Sign in to add photos.");
  mark("auth");

  const parsed = ingestBody.safeParse(await request.json().catch(() => null));
  mark("parse");
  if (!parsed.success) return fail(400, "That photo is missing something we need.");
  const v = parsed.data;

  // The path must be inside this job's own prefix — a caller cannot point the
  // ingest at somebody else's object.
  if (!v.path.startsWith(`wo/${v.workOrderId}/`)) return fail(400, "That file isn't part of this job.");

  // The Range read is the cheap path; a store that answers it oddly falls back
  // to the whole object (a photo — a video is only ever read by Range).
  let bytes = await stagedHeadBytes(supabase, "wo-photos", v.path);
  mark("head");
  if ((!bytes || bytes.length < 12) && !isVideoPath(v.path)) {
    const { data: blob, error: dlError } = await supabase.storage.from("wo-photos").download(v.path);
    if (dlError) reportError(dlError, { where: "wo.photos.ingest.download", bestEffort: true, extra: { path: v.path } });
    if (blob) bytes = new Uint8Array(await blob.arrayBuffer()).slice(0, 64);
    mark("download");
  }
  if (!bytes || bytes.length < 12) {
    reportError(new Error("wo.photos.ingest: staged object unreadable"), { where: "wo.photos.ingest", extra: { path: v.path } });
    return fail(400, "We couldn't read that upload back from the photo store — please try again.");
  }

  // The name says what the bytes must be: a video extension needs a video
  // signature, a bare photo path needs a photo signature. Anything else goes.
  const namedVideo = isVideoPath(v.path);
  const videoKind = sniffVideoKind(bytes);
  const imageKind = sniffKind(bytes);
  const isImage = imageKind !== null && imageKind !== "pdf";
  const accepted = namedVideo ? videoKind !== null : isImage;
  if (!accepted) {
    // Don't leave the rejected object sitting in the bucket.
    await supabase.storage.from("wo-photos").remove([v.path]).catch(() => {});
    return fail(400, namedVideo
      ? "That doesn't look like a video we can play. Record it again, or pick an MP4 or MOV."
      : "That doesn't look like a photo. Take it again, or pick a JPEG or PNG.");
  }

  // A 'reference' photo is the OFFICE telling the painter something, so it goes
  // through its own staff-gated function (20270190). wo_record_photo is granted
  // to every authenticated caller and would happily let a contractor file one
  // as though it came from us.
  const { data: result, error } = v.kind === "reference"
    ? await supabase.rpc("wo_record_reference_photo", {
        p_work_order_id: v.workOrderId,
        p_storage_path: v.path,
        p_area: v.area,
        p_caption: v.caption,
      })
    : await supabase.rpc("wo_record_photo", {
        p_work_order_id: v.workOrderId,
        p_kind: v.kind,
        p_storage_path: v.path,
        p_surface_id: v.surfaceId ?? null,
        p_area: v.area,
        p_caption: v.caption,
      });
  mark("record");
  if (error) {
    reportError(error, { where: "wo.photos.record", extra: { path: v.path } });
    return done(fail(502, "The photo uploaded but we couldn't file it — try again."));
  }

  const s = String(result ?? "");
  if (!s.startsWith("ok:")) {
    await supabase.storage.from("wo-photos").remove([v.path]).catch(() => {});
    if (s.includes("not_yours")) return fail(403, "That job isn't yours.");
    if (s.includes("not_staff")) return fail(403, "Only the office can attach a photo to a job sheet.");
    if (s.includes("closed")) return fail(409, "This job is closed — its job sheet is final.");
    return fail(400, "We couldn't file that photo.");
  }
  const photoId = s.slice(3);

  // Link to a variation on the SAME job. The caller already proved they can
  // write photos on this work order (wo_record_photo); the variation must
  // belong to it too, checked through the caller's own RLS read. The write
  // itself needs the service client — authenticated writes on wo_photos are
  // revoked by design.
  if (v.variationId) {
    const { data: variation } = await supabase
      .from("wo_variations").select("id, work_order_id")
      .eq("id", v.variationId).maybeSingle();
    if (!variation || variation.work_order_id !== v.workOrderId) {
      return fail(400, "That change isn't part of this job.");
    }
    const service = createServiceClient();
    const { error: linkError } = service
      ? await service.from("wo_photos")
          .update({ variation_id: v.variationId, kind: "variation" })
          .eq("id", photoId).eq("work_order_id", v.workOrderId)
      : { error: { message: "service client unavailable" } };
    if (linkError) {
      reportError(linkError, { where: "wo.photos.linkVariation", extra: { photoId } });
      return fail(502, "The photo uploaded but we couldn't pin it to the change — try again.");
    }
  }

  return done(NextResponse.json({ id: photoId, path: v.path }));
}
