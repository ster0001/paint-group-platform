import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { makeIncomingPath } from "@/lib/uploads/incoming";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/upload-url — A3: stage 1 of the plan upload.
 *
 * The serverless platform caps request bodies at ~4.5 MB, far below a real
 * plan PDF or phone photo, and refuses larger ones with an error page the
 * client can't parse — the "silent" upload failure from live testing. So
 * uploads now go straight to storage: this route hands out signed upload
 * URLs into the caller's own `incoming/{userId}/` staging prefix, the client
 * PUTs the bytes, and /api/extract/floorplan ingests the staged objects
 * (where the magic-byte validation still happens — a signed URL is
 * permission to store bytes, never a statement of what they are).
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  files: z.array(z.object({
    name: z.string().max(200).default("upload"),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })).min(1).max(5),
});

function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return fail(403, "Only Paint Group staff can upload plans.");
  const user = actor.user;
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return fail(503, "The estimate wizard isn't available just now — please try again later.");
    db = svc;
    // The same visitor budget as the process route, checked before any URL
    // is handed out.
    const { count } = await db.from("estimate_sources")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);
    if ((count ?? 0) >= 30) {
      return fail(429, "That's plenty of pages for one estimate — talk to us and we'll take it from here.");
    }
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Tell us the file names and sizes first.");

  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const uploads: Array<{ path: string; token: string }> = [];
  for (let i = 0; i < parsed.data.files.length; i++) {
    const path = makeIncomingPath(user.id, i, stamp);
    const { data, error } = await db.storage.from("estimate-sources").createSignedUploadUrl(path);
    if (error || !data) {
      reportError(error, { where: "extract.signedUploadUrl", extra: { path } });
      return fail(502, "Couldn't get the upload ready — try again in a moment.");
    }
    uploads.push({ path: data.path, token: data.token });
  }

  return NextResponse.json({ uploads });
}
