import { NextResponse } from "next/server";
import { z } from "zod";
import { getContractorSession } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { agreementDocUrl } from "@/lib/agreements/pdf";

export const dynamic = "force-dynamic";

/**
 * Download a signed agreement (brief §10): the row is read through the
 * contractor's OWN session, so RLS decides — another contractor's id is a
 * 404, never a 403. The bucket is private; the answer is a redirect to a
 * ten-minute signed URL.
 */
export async function GET(req: Request) {
  const session = await getContractorSession();
  if (!session.contractor) return new NextResponse("Not found", { status: 404 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  const db = await createClient();
  let q = db.from("contractor_agreements").select("id, pdf_path").eq("contractor_id", session.contractor.id);
  q = id.success ? q.eq("id", id.data) : q.eq("status", "signed");
  const { data, error } = await q.limit(1).maybeSingle();
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  const row = data as { id: string; pdf_path: string | null };
  if (!row.pdf_path) return new NextResponse("The PDF is still being prepared. Try again in a moment.", { status: 409 });
  const service = createServiceClient();
  const url = service ? await agreementDocUrl(service, row.pdf_path) : null;
  if (!url) return new NextResponse("The PDF could not be fetched. Try again in a moment.", { status: 503 });
  return NextResponse.redirect(url, 302);
}
