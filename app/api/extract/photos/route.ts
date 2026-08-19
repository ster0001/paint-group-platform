import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseUpload } from "@/lib/extract/normalise";
import { isOwnIncomingPath } from "@/lib/uploads/incoming";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/photos — R1.3: condition photos WITHOUT a plan run.
 *
 * Condition photos are their own document type; they must never require a
 * floorplan. When there is no plan run to fold them into (the no-plan path),
 * the photos are still validated, kept as evidence (kind=defect_photo) and
 * ride to the estimator — no AI analysis, no silent drop. The analysed path
 * stays at /api/extract/:runId/photos.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PHOTOS = 12;

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  const staged = z.object({
    uploads: z.array(z.object({
      path: z.string().min(1).max(400),
      name: z.string().max(200).default("photo"),
    })).min(1).max(MAX_PHOTOS),
  }).safeParse(await request.json().catch(() => null));
  if (!staged.success) return NextResponse.json({ error: "Send the staged photo paths." }, { status: 400 });

  const perPhoto: Array<{ file: string; error?: string; kept?: boolean }> = [];
  const stagedToClean: string[] = [];
  let kept = 0;

  for (const u of staged.data.uploads) {
    if (!isOwnIncomingPath(u.path, actor.user.id)) {
      return NextResponse.json({ error: "That upload isn't yours to attach." }, { status: 403 });
    }
    stagedToClean.push(u.path);
    const { data, error } = await db.storage.from("estimate-sources").download(u.path);
    if (error || !data) { perPhoto.push({ file: u.name, error: "didn't finish uploading — try that photo again" }); continue; }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const check = normaliseUpload(bytes, undefined, u.name);
    if (!check.ok) { perPhoto.push({ file: u.name, error: check.message }); continue; }
    if (check.kind === "pdf") { perPhoto.push({ file: u.name, error: "Photos only here — a PDF plan goes through the plan upload." }); continue; }

    const path = `condition/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${check.kind}`;
    const up = await db.storage.from("estimate-sources").upload(path, bytes, { contentType: check.mime });
    if (up.error) {
      reportError(up.error, { where: "extract.conditionPhotoKeep", bestEffort: true });
      perPhoto.push({ file: u.name, error: "couldn't be saved — try again" });
      continue;
    }
    const ins = await db.from("estimate_sources").insert({
      kind: "defect_photo",
      storage_path: path,
      mime_type: check.mime,
      byte_size: bytes.length,
      page_class: "photo",
      page_class_confidence: 0.95,
      created_by: actor.user.id,
    });
    if (ins.error) {
      reportError(ins.error, { where: "extract.conditionPhotoRecord", bestEffort: true });
      perPhoto.push({ file: u.name, error: "couldn't be recorded — try again" });
      continue;
    }
    kept++;
    perPhoto.push({ file: u.name, kept: true });
  }

  if (stagedToClean.length) {
    await db.storage.from("estimate-sources").remove(stagedToClean).then(() => null, () => null);
  }

  return NextResponse.json({ kept, perPhoto });
}
