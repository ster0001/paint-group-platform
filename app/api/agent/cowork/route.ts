import { NextResponse } from "next/server";
import { z } from "zod";
import { openCoworkSession } from "@/lib/agent/session";

/**
 * POST { estimateId? } — the builder's embedded assistant: find-or-create the
 * staff co-work conversation for an estimate (or a fresh staff draft when
 * there is none yet) and return the transcript + ui. Staff only (the session
 * helper checks the role).
 */
export async function POST(request: Request) {
  const parsed = z.object({ estimateId: z.string().trim().max(64).optional() })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const session = await openCoworkSession(parsed.data.estimateId || "new");
  if (session.kind === "holding") return NextResponse.json({ error: session.line }, { status: 403 });
  return NextResponse.json(session);
}
