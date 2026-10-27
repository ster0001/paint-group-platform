import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { signPhotoRendition } from "@/lib/portal/photos";

/**
 * 3a-8 · A photo rendition, minted on demand. Since 27 Oct 2026 (Chris, Rose
 * Street) this is the ONLY way a portal photo reaches a browser: the timeline
 * puts `/account/photo/[id]?size=thumb` in every tile and the full-screen tap
 * comes here without a size. Ownership is re-proven through the account
 * chain, the KIND is re-checked (qa-kind photos can never leave, whatever id
 * is guessed), and the caller is redirected to a 640px or 1600px rendition —
 * still never the original (§10.3). One storage call per photo SEEN.
 */
const CUSTOMER_KINDS = new Set(["before", "progress", "completion"]);
const sizeSchema = z.enum(["thumb", "full"]).catch("full");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  if (!z.string().uuid().safeParse(photoId).success) return new NextResponse(null, { status: 404 });
  const size = sizeSchema.parse(request.nextUrl.searchParams.get("size") ?? "full");

  const ctx = await getPortalContext();
  if (!ctx || !ctx.accounts.length) return new NextResponse(null, { status: 404 });
  const owned = new Set(ctx.accounts.map((a) => a.id));

  const svc = createServiceClient();
  if (!svc) return new NextResponse(null, { status: 404 });

  const { data: photo } = await svc
    .from("wo_photos")
    .select("kind, storage_path, work_orders!inner(estimates!inner(account_id))")
    .eq("id", photoId)
    .maybeSingle();
  const row = photo as {
    kind: string; storage_path: string;
    work_orders?: { estimates?: { account_id: string | null } };
  } | null;
  const accountId = row?.work_orders?.estimates?.account_id;
  if (!row || !CUSTOMER_KINDS.has(row.kind) || !accountId || !owned.has(accountId)) {
    return new NextResponse(null, { status: 404 });
  }

  const url = await signPhotoRendition(svc, row.storage_path, size);
  if (!url) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url);
}
