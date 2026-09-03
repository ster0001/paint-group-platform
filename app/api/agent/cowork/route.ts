import { NextResponse } from "next/server";
import { openCoworkSession } from "@/lib/agent/session";

/**
 * POST { estimateId? } — the builder's embedded assistant: find-or-create the
 * staff co-work conversation for an estimate (or a fresh staff draft when
 * there is none yet) and return the transcript + ui. Staff only (the session
 * helper checks the role).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { estimateId?: string };
  const session = await openCoworkSession(body.estimateId?.trim() || "new");
  if (session.kind === "holding") return NextResponse.json({ error: session.line }, { status: 403 });
  return NextResponse.json(session);
}
