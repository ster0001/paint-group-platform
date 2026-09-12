import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normaliseUpload } from "@/lib/extract/normalise";
import { reportError } from "@/lib/monitoring/report";
import { tenantLinkExpired } from "@/lib/portal/tenant-link";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILES = 12;
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * C15 (A4) — the tenant's photos. The token is the identity: no session,
 * no account. Each photo is normalised (the same check every wizard photo
 * takes), stored under the estimate's sources bucket and recorded as a
 * `defect_photo` on the ESTIMATE the link was made from, so the estimator's
 * pack shows them beside the agent's own; the link's row keeps the ids so
 * the agent sees what came in (⚑61). Reading the photos for condition
 * (`photo_review`) is the estimator's step, not this route's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "That link isn't right." }, { status: 404 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "Uploads aren't available just now." }, { status: 503 });

  const { data: link } = await db.from("tenant_photo_links")
    .select("id, estimate_id, property_id, status, expires_at, uploaded_photo_ids").eq("token", token).maybeSingle();
  if (!link) return NextResponse.json({ error: "That link isn't right." }, { status: 404 });
  if (link.status === "expired" || tenantLinkExpired(link.expires_at as string | null)) {
    return NextResponse.json({ error: "This link has expired — ask your property manager for a fresh one." }, { status: 410 });
  }

  let form: FormData;
  try { form = await request.formData(); } catch {
    return NextResponse.json({ error: "Send the photos as a form." }, { status: 400 });
  }
  const files = form.getAll("photos").filter((f): f is File => typeof f === "object" && f != null && "arrayBuffer" in f).slice(0, MAX_FILES);
  if (!files.length) return NextResponse.json({ error: "Pick at least one photo." }, { status: 400 });

  const ids: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) { errors.push(`${f.name}: too large`); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const check = normaliseUpload(bytes, f.type || undefined, f.name);
    if (!check.ok) { errors.push(`${f.name}: ${check.message}`); continue; }
    if (check.kind === "pdf") { errors.push(`${f.name}: photos only`); continue; }
    const path = `tenant/${link.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${check.kind}`;
    const up = await db.storage.from("estimate-sources").upload(path, bytes, { contentType: check.mime });
    if (up.error) { reportError(up.error, { where: "tenant.upload", bestEffort: true }); errors.push(`${f.name}: couldn't be saved`); continue; }
    const ins = await db.from("estimate_sources").insert({
      kind: "defect_photo", estimate_id: link.estimate_id, storage_path: path,
      mime_type: check.mime, byte_size: bytes.length, page_class: "photo", page_class_confidence: 0.95,
    }).select("id").maybeSingle();
    if (ins.error || !ins.data?.id) { reportError(ins.error, { where: "tenant.record", bestEffort: true }); errors.push(`${f.name}: couldn't be recorded`); continue; }
    ids.push(ins.data.id as string);
  }

  const all = [...((link.uploaded_photo_ids as string[] | null) ?? []), ...ids];
  if (ids.length) {
    await db.from("tenant_photo_links").update({ uploaded_photo_ids: all, status: "photos_received" }).eq("id", link.id);
    await db.from("estimate_events").insert({
      estimate_id: link.estimate_id, type: "tenant_photos", payload: { count: ids.length, linkId: link.id },
    }).then((r) => { if (r.error) reportError(r.error, { where: "tenant.event", bestEffort: true }); });
  }
  return NextResponse.json({ kept: ids.length, total: all.length, errors });
}
