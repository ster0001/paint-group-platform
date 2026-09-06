import { NextResponse } from "next/server";
import { z } from "zod";
import { agentActor, agentDb, latestEstimateForActor, openSupportSession } from "@/lib/agent/session";
import { getCompanyContact } from "@/lib/portal/data";

/**
 * POST /api/agent/support — the chat widget's way in (Tom, 7 Sep 2026).
 *
 * Opens (or resumes) the SUPPORT conversation on one of the customer's own
 * estimates: the one named in the body, else their newest. Support mode
 * only — it answers from the estimate, the Brain and a person; the guided
 * describe-the-job chat and staff co-work are never reachable from here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ estimateId: z.string().uuid().optional() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  let estimateId = parsed.data.estimateId ?? null;
  if (!estimateId) {
    const actor = await agentActor();
    const db = agentDb();
    if (!actor || !db) return NextResponse.json({ error: "Sign in to chat about your estimate." }, { status: 401 });
    estimateId = await latestEstimateForActor(db, actor);
    if (!estimateId) return NextResponse.json({ error: "There's no estimate to talk about yet — start one and come back." }, { status: 404 });
  }
  const [session, company] = await Promise.all([openSupportSession(estimateId), getCompanyContact()]);
  if (session.kind === "holding") return NextResponse.json({ error: session.line }, { status: 403 });
  return NextResponse.json({ ...session, companyPhone: company.phone || null });
}
