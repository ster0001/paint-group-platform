import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";

/**
 * 3a-5 · Company-credential download for signed-in customers: any member may
 * download the ACTIVE certificates (that is their purpose — §5), served as
 * short-lived signed URLs from the private bucket. Everything else is a 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  if (!z.string().uuid().safeParse(docId).success) return new NextResponse(null, { status: 404 });

  const ctx = await getPortalContext();
  if (!ctx) return new NextResponse(null, { status: 404 });

  const svc = createServiceClient();
  if (!svc) return new NextResponse(null, { status: 404 });

  const { data: doc } = await svc
    .from("company_documents").select("storage_path, active").eq("id", docId).maybeSingle();
  if (!doc || !(doc as { active: boolean }).active) return new NextResponse(null, { status: 404 });

  const { data: signed, error } = await svc.storage
    .from("company-docs")
    .createSignedUrl((doc as { storage_path: string }).storage_path, 300);
  if (error || !signed?.signedUrl) {
    reportError(error, { where: "portal.document.sign", bestEffort: true });
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.redirect(signed.signedUrl);
}
