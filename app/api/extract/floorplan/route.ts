import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseUpload, classifyPage } from "@/lib/extract/normalise";
import { convertHeicToJpeg } from "@/lib/extract/heic";
import { readPdf, MAX_PAGES } from "@/lib/extract/pdf";
import { isOwnIncomingPath } from "@/lib/uploads/incoming";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/floorplan
 *
 * Upload a plan; get back a run id. NO MODEL CALL YET — this establishes the
 * boundary, the storage layout and the page routing, which is the part where
 * the accuracy lives. The vision call slots into the run row in P1.
 *
 * What it does, in order:
 *   1. staff only
 *   2. validate by MAGIC BYTES, not the declared type or the file name
 *   3. rasterise each PDF page at 200 DPI, and lift its text layer
 *   4. classify each page so interior/exterior routing is decided before any
 *      model is involved
 *   5. store the original and the page renditions in a private bucket
 *   6. write one estimate_sources row per page and one extraction_run
 *
 * This is the app's first API route, and deliberately the shape the other
 * mutations should move to: zod at the boundary, the caller's identity checked
 * server-side, nothing trusted from the client, and no money anywhere near it.
 *
 * NOTE ON THE SERVICE-ROLE KEY: the brief specifies one. This app has never had
 * one — it runs entirely on the anon key plus RLS, which the August audit
 * confirmed. So the route uses the CALLER'S session, and the storage policies
 * and RLS do the enforcing. That is strictly safer than adding a key that
 * bypasses RLS, and it is why every insert below is scoped by is_staff().
 */

export const runtime = "nodejs"; // mupdf is WASM + Node APIs, not edge
export const maxDuration = 60;

const querySchema = z.object({
  // Optional: attach to an existing estimate. Absent means the plan is read
  // first and the estimate is created by /apply later.
  estimateId: z.string().uuid().optional(),
  kind: z.enum(["floorplan", "site_plan", "elevation", "listing"]).default("floorplan"),
});

const MAX_FILES = 5;

type PageRow = {
  pageNo: number;
  text: string;
  pageClass: string;
  confidence: number;
  reasons: string[];
  hasTextLayer: boolean;
  storagePath: string;
  thumbPath: string;
  widthPx: number;
  heightPx: number;
};

function fail(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Supabase Storage sometimes returns an error whose `message` is empty, which
 * reached the screen as "Couldn't store that file: " and told nobody anything.
 * A transient blip during a batch upload is exactly when a diagnosable message
 * matters most.
 */
function describeStorageError(e: unknown): string {
  const err = e as { message?: string; name?: string; statusCode?: string | number; status?: number } | null;
  const parts = [err?.message, err?.name, err?.statusCode != null ? `status ${err.statusCode}` : null,
                 err?.status != null ? `status ${err.status}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "the storage service refused it without saying why — try again";
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // ---- 1. who is calling ----------------------------------------------------
  // Staff, or a Step 8 customer-wizard visitor (anonymous auth). Customers get
  // no direct table access; their writes go through the service client with
  // this route's own checks. Anyone else is refused.
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return fail(403, "Only Paint Group staff can upload plans.");
  const user = actor.user;
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return fail(503, "The estimate wizard isn't available just now — please try again later.");
    db = svc;
    // A visitor gets a generous but finite page budget.
    const { count } = await db.from("estimate_sources")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);
    if ((count ?? 0) >= 30) {
      return fail(429, "That's plenty of pages for one estimate — talk to us and we'll take it from here.");
    }
  }

  // ---- 2. validate the request ---------------------------------------------
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    estimateId: url.searchParams.get("estimateId") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
  });
  if (!parsedQuery.success) {
    return fail(400, parsedQuery.error.issues[0]?.message ?? "Invalid request.");
  }
  const { estimateId, kind } = parsedQuery.data;
  // A customer never attaches uploads to an existing estimate directly — the
  // submit route owns that binding, with ownership checks.
  if (actor.kind === "customer" && estimateId) {
    return fail(403, "Uploads can't be attached to an estimate from here.");
  }

  // A3: two ways in. Small requests may still arrive as multipart; the wizard
  // now stages big files in storage via a signed URL and posts JSON paths —
  // the serverless body cap (~4.5 MB) silently killed real plan uploads.
  type Incoming = { bytes: Uint8Array; declaredMime?: string; name: string; stagedPath?: string };
  const incoming: Incoming[] = [];

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const staged = z.object({
      uploads: z.array(z.object({
        path: z.string().min(1).max(400),
        name: z.string().max(200).default("upload"),
      })).min(1).max(MAX_FILES),
    }).safeParse(await request.json().catch(() => null));
    if (!staged.success) return fail(400, "Send the staged upload paths.");

    for (const u of staged.data.uploads) {
      // The path IS the ownership check — only this caller's staging prefix,
      // no traversal, before any storage call sees it.
      if (!isOwnIncomingPath(u.path, user.id)) return fail(403, "That upload isn't yours to attach.");
      const { data, error } = await db.storage.from("estimate-sources").download(u.path);
      if (error || !data) {
        return fail(400, `"${u.name}" didn't finish uploading — please try that file again.`);
      }
      incoming.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: u.name, stagedPath: u.path });
    }
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "Send the file as multipart/form-data.");
    }
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return fail(400, "No file was attached.");
    if (files.length > MAX_FILES) return fail(400, `Upload up to ${MAX_FILES} files at a time.`);
    for (const file of files) {
      incoming.push({ bytes: new Uint8Array(await file.arrayBuffer()), declaredMime: file.type, name: file.name });
    }
  }

  const runIds: string[] = [];
  const allPages: PageRow[] = [];
  const warnings: string[] = [];
  const stagedToClean: string[] = [];

  for (const file of incoming) {
    const bytes = file.bytes;

    // ---- 3. what IS this, per its bytes -------------------------------------
    const check = normaliseUpload(bytes, file.declaredMime, file.name);
    if (!check.ok) return fail(400, check.message);

    const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const folder = estimateId ? `estimates/${estimateId}` : `unassigned/${user.id}`;
    const base = `${folder}/${stamp}`;

    // Keep the original exactly as uploaded — every re-read and every accuracy
    // comparison later works from this, not from a rendition.
    const originalPath = `${base}/original.${check.kind === "pdf" ? "pdf" : check.kind}`;
    const up = await db.storage.from("estimate-sources").upload(originalPath, bytes, {
      contentType: check.mime,
      upsert: false,
    });
    if (up.error) {
      reportError(up.error, { where: "extract.upload", extra: { path: originalPath } });
      return fail(502, `Couldn't store that file: ${describeStorageError(up.error)}`);
    }

    // A3: iPhone HEIC — the models only read JPEG/PNG/WEBP, so a HEIC used to
    // upload "fine" and then silently never read. Convert at ingest; the
    // original .heic stays stored above, the pipeline works from the JPEG.
    let pageBytesPath = originalPath;
    let pageMime = check.mime;
    if (check.kind === "heic") {
      const converted = await convertHeicToJpeg(bytes);
      if (!converted.ok) return fail(422, converted.message);
      pageBytesPath = `${base}/original.jpg`;
      pageMime = "image/jpeg";
      const jp = await db.storage.from("estimate-sources").upload(pageBytesPath, converted.jpeg, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (jp.error) {
        reportError(jp.error, { where: "extract.uploadHeicJpeg", extra: { path: pageBytesPath } });
        return fail(502, `Couldn't store that photo: ${describeStorageError(jp.error)}`);
      }
    }

    const pages: PageRow[] = [];

    if (check.kind === "pdf") {
      const read = await readPdf(bytes);
      if (!read.ok) return fail(422, read.message);
      if (read.pageCount > MAX_PAGES) {
        warnings.push(`${file.name} has ${read.pageCount} pages; the first ${MAX_PAGES} were processed.`);
      }

      for (const page of read.pages) {
        const pagePath = `${base}/page-${String(page.pageNo).padStart(3, "0")}.png`;
        const thumbPath = `${base}/page-${String(page.pageNo).padStart(3, "0")}.thumb.png`;

        const [full, thumb] = await Promise.all([
          db.storage.from("estimate-sources").upload(pagePath, page.png, { contentType: "image/png", upsert: true }),
          db.storage.from("estimate-sources").upload(thumbPath, page.thumbPng, { contentType: "image/png", upsert: true }),
        ]);
        if (full.error || thumb.error) {
          const e = full.error ?? thumb.error;
          reportError(e, { where: "extract.uploadPage", extra: { pagePath } });
          return fail(502, `Couldn't store page ${page.pageNo}: ${describeStorageError(e)}`);
        }

        pages.push({
          pageNo: page.pageNo,
          text: page.text,
          pageClass: page.classification.pageClass,
          confidence: page.classification.confidence,
          reasons: page.classification.reasons,
          hasTextLayer: page.classification.fromTextLayer,
          storagePath: pagePath,
          thumbPath,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
        });
      }
    } else {
      // A photo or a plan supplied as an image: one "page", no text layer.
      // (For HEIC this is the converted JPEG — the readable rendition.)
      const c = classifyPage(null, { isImageFile: true, declaredKind: kind });
      pages.push({
        pageNo: 1,
        text: "",
        pageClass: c.pageClass,
        confidence: c.confidence,
        reasons: c.reasons,
        hasTextLayer: false,
        storagePath: pageBytesPath,
        thumbPath: pageBytesPath,
        widthPx: 0,
        heightPx: 0,
      });
    }

    // ---- 6. rows -------------------------------------------------------------
    for (const page of pages) {
      const { data: source, error: srcErr } = await db
        .from("estimate_sources")
        .insert({
          estimate_id: estimateId ?? null,
          kind,
          storage_path: page.storagePath,
          page_no: page.pageNo,
          mime_type: check.kind === "pdf" ? "image/png" : pageMime,
          byte_size: check.bytes,
          page_class: page.pageClass,
          page_class_confidence: page.confidence,
          // The exact strings off a vector plan. This is what lets the geometry
          // be parsed rather than read off pixels, so it is worth storing even
          // though nothing consumes it until P1.
          text_layer: page.text || null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (srcErr || !source) {
        reportError(srcErr, { where: "extract.insertSource" });
        return fail(500, `Couldn't record that page: ${srcErr?.message}`);
      }

      // One run per page — never one call for a whole document, per the brief.
      const { data: run, error: runErr } = await db
        .from("extraction_runs")
        .insert({
          estimate_source_id: source.id,
          status: "queued",
          prompt_version: null, // set when the model call lands in P1
          validation_report: {
            page_classification: {
              page_class: page.pageClass,
              confidence: page.confidence,
              reasons: page.reasons,
              from_text_layer: page.hasTextLayer,
            },
            rendition: { width_px: page.widthPx, height_px: page.heightPx, dpi: 200 },
          },
          created_by: user.id,
        })
        .select("id")
        .single();

      if (runErr || !run) {
        reportError(runErr, { where: "extract.insertRun" });
        return fail(500, `Couldn't start the read: ${runErr?.message}`);
      }
      runIds.push(run.id);
      allPages.push(page);
    }

    if (file.stagedPath) stagedToClean.push(file.stagedPath);
  }

  // The staged copies have served their purpose; best-effort cleanup.
  if (stagedToClean.length) {
    await db.storage.from("estimate-sources").remove(stagedToClean).then(() => null, () => null);
  }

  // Interior geometry comes off floorplan pages only; say so plainly rather
  // than letting the caller assume every page was useful.
  const usable = allPages.filter((p) => p.pageClass === "floorplan_interior").length;
  if (usable === 0) {
    warnings.push("No page looked like a dimensioned floor plan. Check the debug view before reading it.");
  }

  return NextResponse.json({
    runIds,
    primaryRunId: runIds[0] ?? null,
    pages: allPages.map((p) => ({
      pageNo: p.pageNo,
      pageClass: p.pageClass,
      confidence: p.confidence,
      reasons: p.reasons,
      hasTextLayer: p.hasTextLayer,
    })),
    floorplanPages: usable,
    warnings,
  });
}
