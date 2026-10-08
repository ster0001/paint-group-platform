import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sniffKind, MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { reportError } from "@/lib/monitoring/report";
import { stagedHeadBytes } from "@/lib/workorder/stagedBytes";
import { SITE_VISIT_BUCKET, siteVisitPhotoPrefix } from "@/lib/workorder/siteVisits";

/**
 * Photos on a site check-in note (Tom, 9 Oct 2026) — STAFF ONLY.
 *
 * The work-order photo path, unchanged in shape: POST hands out a signed upload
 * URL into the private `site-visit-photos` bucket (20270248), the browser PUTs
 * the bytes straight to storage, then PUT here reads the STAGED BYTES and only
 * a real photo is filed against the note (wo_site_visit_record_photo). A file
 * that is not a photo is deleted, never left in the bucket. Size is refused at
 * the sign step (and the bucket's own limit is the same 25 MB); the declared
 * type must be an image; the bytes decide.
 *
 * Every read here is the STAFF member's own session: the visit and the note
 * are staff-only rows, so a painter or customer asking gets a 404.
 */
export const runtime = "nodejs";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

const signBody = z.object({
  visitId: z.string().uuid(),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: z.enum(IMAGE_TYPES),
});

const ingestBody = z.object({
  noteId: z.string().uuid(),
  path: z.string().min(1).max(300),
});

const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(403, "Sign in to add photos.");

  const parsed = signBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.path[0];
    return fail(400, issue === "size" ? `That photo is too big — up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
      : issue === "contentType" ? "Only photos can go on a site check-in (JPEG, PNG, WebP or HEIC)."
      : "Tell us which site check-in the photo belongs to.");
  }

  const { data: visit, error } = await supabase
    .from("wo_site_visits").select("id, work_order_id").eq("id", parsed.data.visitId).maybeSingle();
  if (error) {
    reportError(error, { where: "siteVisit.photos.visit", extra: { visitId: parsed.data.visitId } });
    return fail(502, "Couldn't find that site check-in — try again in a moment.");
  }
  if (!visit) return fail(404, "That site check-in isn't there.");
  const v = visit as { id: string; work_order_id: string };

  const path = `${siteVisitPhotoPrefix(v.work_order_id, v.id)}${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { data, error: signError } = await supabase.storage.from(SITE_VISIT_BUCKET).createSignedUploadUrl(path);
  if (signError || !data) {
    reportError(signError, { where: "siteVisit.photos.signedUploadUrl", extra: { path } });
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
  const { noteId, path } = parsed.data;

  const { data: note, error } = await supabase
    .from("wo_site_visit_notes").select("id, visit_id, work_order_id").eq("id", noteId).maybeSingle();
  if (error) {
    reportError(error, { where: "siteVisit.photos.note", extra: { noteId } });
    return fail(502, "Couldn't find that note — try again in a moment.");
  }
  if (!note) return fail(404, "That note isn't there.");
  const n = note as { id: string; visit_id: string; work_order_id: string };
  if (!path.startsWith(siteVisitPhotoPrefix(n.work_order_id, n.visit_id))) return fail(400, "That file isn't part of this site check-in.");

  let bytes = await stagedHeadBytes(supabase, SITE_VISIT_BUCKET, path);
  if (!bytes || bytes.length < 12) {
    const { data: blob, error: dlError } = await supabase.storage.from(SITE_VISIT_BUCKET).download(path);
    if (dlError) reportError(dlError, { where: "siteVisit.photos.download", bestEffort: true, extra: { path } });
    if (blob) bytes = new Uint8Array(await blob.arrayBuffer()).slice(0, 64);
  }
  if (!bytes || bytes.length < 12) {
    reportError(new Error("siteVisit.photos: staged object unreadable"), { where: "siteVisit.photos.ingest", extra: { path } });
    return fail(400, "We couldn't read that upload back from the photo store — please try again.");
  }
  const kind = sniffKind(bytes);
  if (kind === null || kind === "pdf") {
    const { error: rmError } = await supabase.storage.from(SITE_VISIT_BUCKET).remove([path]);
    if (rmError) reportError(rmError, { where: "siteVisit.photos.removeRejected", bestEffort: true, extra: { path } });
    return fail(400, "That doesn't look like a photo. Take it again, or pick a JPEG or PNG.");
  }

  const { data: result, error: recError } = await supabase.rpc("wo_site_visit_record_photo", { p_note_id: noteId, p_storage_path: path });
  if (recError) {
    reportError(recError, { where: "siteVisit.photos.record", extra: { path } });
    return fail(502, "The photo uploaded but we couldn't file it — try again.");
  }
  const s = String(result ?? "");
  if (!s.startsWith("ok:")) {
    if (s !== "error:already_recorded") {
      const { error: rmError } = await supabase.storage.from(SITE_VISIT_BUCKET).remove([path]);
      if (rmError) reportError(rmError, { where: "siteVisit.photos.removeRefused", bestEffort: true, extra: { path } });
    }
    if (s.includes("not_staff")) return fail(403, "Only the office can add photos to a site check-in.");
    return fail(400, "We couldn't file that photo.");
  }
  return NextResponse.json({ id: s.slice(3), path });
}
