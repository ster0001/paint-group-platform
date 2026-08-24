import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_BYTES } from "@/lib/extract/normalise";
import { COST_DOCS_BUCKET, safeFileName } from "@/lib/costs/store";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * Manual cost documents — the sign half of the remediated upload path. POST
 * hands a staff member a signed upload URL inside their own receipts prefix
 * (the storage policy enforces it); the browser PUTs the bytes straight to
 * storage; recordJobCostAction ingests, sniffing the staged bytes before any
 * row is written. No cost row exists without a source document.
 */

const signBody = z.object({
  fileName: z.string().max(200).default("document"),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add costs." }, { status: 403 });

  const parsed = signBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell us about the file first." }, { status: 400 });
  }

  const name = safeFileName(parsed.data.fileName, "document").slice(-60);
  const path = `receipts/${user.id}/${Date.now()}-${randomUUID().slice(0, 8)}-${name}`;
  const { data, error } = await supabase.storage.from(COST_DOCS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    reportError(error, { where: "costs.doc.signedUploadUrl", extra: { path } });
    return NextResponse.json(
      { error: "Couldn't get the upload ready — has migration 20261122 been run?" },
      { status: 502 },
    );
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
