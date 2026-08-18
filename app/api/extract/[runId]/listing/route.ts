import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkListingUrl, parseListing, crossCheck } from "@/lib/extract/listing";
import { extractionSchema } from "@/lib/extract/schema";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/extract/:runId/listing  { url }
 *
 * Cross-check a plan reading against the property's listing page. It returns
 * QUESTIONS, never corrections: a listing is copy written to sell a house, so
 * it can tell us the bedroom count disagrees, or that the agent mentions high
 * ceilings, but it never sets a number.
 *
 * The URL is checked against an allow-list before we fetch it — see
 * lib/extract/listing.ts for why that matters when the server does the fetching.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({ url: z.string().min(8).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return NextResponse.json({ error: "Bad run id." }, { status: 400 });
  }

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  let db: SupabaseClient = supabase;
  if (actor.kind === "customer") {
    const svc = createServiceClient();
    if (!svc) return NextResponse.json({ error: "The estimate wizard isn't available just now." }, { status: 503 });
    db = svc;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a listing URL." }, { status: 400 });

  const check = checkListingUrl(parsed.data.url);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

  const { data: run } = await db.from("extraction_runs").select("id, raw_output, created_by").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  if (actor.kind === "customer" && (run as { created_by?: string | null }).created_by !== actor.user.id) {
    return NextResponse.json({ error: "No such run." }, { status: 404 });
  }

  let html: string;
  try {
    const res = await fetch(check.url, {
      redirect: "error", // a redirect could land off the allow-list
      headers: { "user-agent": "PaintGroupEstimator/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ error: `The listing page returned ${res.status}.` }, { status: 502 });
    html = (await res.text()).slice(0, 2_000_000);
  } catch (e) {
    reportError(e, { where: "extract.listingFetch", extra: { host: check.url.hostname } });
    return NextResponse.json(
      { error: "Couldn't open that listing — some sites block automated access. Save the photos and upload them instead." },
      { status: 502 },
    );
  }

  const facts = parseListing(html);

  let notes: string[] = [];
  const reading = extractionSchema.safeParse(run.raw_output);
  if (reading.success) {
    const rooms = reading.data.rooms;
    notes = crossCheck(facts, {
      bedrooms: rooms.filter((r) => r.normalised_type === "bedroom").length,
      bathrooms: rooms.filter((r) => r.normalised_type === "bathroom").length,
    });
  }

  return NextResponse.json({ source: check.url.hostname, facts, notes });
}
