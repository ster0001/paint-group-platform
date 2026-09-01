import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sniffKind, MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { reportError } from "@/lib/monitoring/report";

/**
 * Work-order site photos — the before/progress/QA/completion record.
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
 */

export const runtime = "nodejs";

const KINDS = ["before", "progress", "qa", "completion", "variation"] as const;

const signBody = z.object({
  workOrderId: z.string().uuid(),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
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

/** Photos live under the work order they belong to, one flat level. */
function photoPath(workOrderId: string): string {
  return `wo/${workOrderId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(403, "Sign in to add photos.");

  const parsed = signBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Tell us which job the photo belongs to.");

  // RLS decides whether this caller can see the job at all; a contractor who
  // isn't on it gets no row back and therefore no upload URL.
  const { data: wo } = await supabase
    .from("work_orders").select("id").eq("id", parsed.data.workOrderId).maybeSingle();
  if (!wo) return fail(404, "That job isn't yours.");

  const path = photoPath(parsed.data.workOrderId);
  const { data, error } = await supabase.storage.from("wo-photos").createSignedUploadUrl(path);
  if (error || !data) {
    reportError(error, { where: "wo.photos.signedUploadUrl", extra: { path } });
    return fail(502, "Couldn't get the upload ready — try again in a moment.");
  }
  return NextResponse.json({ path: data.path, token: data.token });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(403, "Sign in to add photos.");

  const parsed = ingestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "That photo is missing something we need.");
  const v = parsed.data;

  // The path must be inside this job's own prefix — a caller cannot point the
  // ingest at somebody else's object.
  if (!v.path.startsWith(`wo/${v.workOrderId}/`)) return fail(400, "That file isn't part of this job.");

  const { data: blob, error: dlError } = await supabase.storage.from("wo-photos").download(v.path);
  if (dlError || !blob) return fail(400, "We couldn't find that upload — please try again.");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const kind = sniffKind(bytes);
  const isImage = kind !== null && kind !== "pdf";
  if (!isImage) {
    // Don't leave the rejected object sitting in the bucket.
    await supabase.storage.from("wo-photos").remove([v.path]).catch(() => {});
    return fail(400, "That doesn't look like a photo. Take it again, or pick a JPEG or PNG.");
  }

  const { data: result, error } = await supabase.rpc("wo_record_photo", {
    p_work_order_id: v.workOrderId,
    p_kind: v.kind,
    p_storage_path: v.path,
    p_surface_id: v.surfaceId ?? null,
    p_area: v.area,
    p_caption: v.caption,
  });
  if (error) {
    reportError(error, { where: "wo.photos.record", extra: { path: v.path } });
    return fail(502, "The photo uploaded but we couldn't file it — try again.");
  }

  const s = String(result ?? "");
  if (!s.startsWith("ok:")) {
    await supabase.storage.from("wo-photos").remove([v.path]).catch(() => {});
    if (s.includes("not_yours")) return fail(403, "That job isn't yours.");
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

  return NextResponse.json({ id: photoId, path: v.path });
}
