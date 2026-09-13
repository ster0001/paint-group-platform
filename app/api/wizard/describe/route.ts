import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { extractBrief, heuristicExtract, detectInjectedInstructions, type BriefExtraction } from "@/lib/agent/brief-extract";
import { loadAgentSettings } from "@/lib/agent/store-supabase";
import { usingStubModel } from "@/lib/agent/gateway";
import { AnthropicModelClient } from "@/lib/agent/model-anthropic";
import { quickLookFromBrief, describeReply } from "@/lib/wizard/describe";
import { DEFAULT_QUICK_LOOK, type QuickLook } from "@/lib/wizard/quick-look";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * C16 (a) — POST /api/wizard/describe: "describe it", behind the chat bubble.
 *
 * Reads the paragraph with the brief reader and answers with quick-look
 * fields plus which ones it filled. It WRITES NOTHING: no draft, no
 * estimate, no conversation. The wizard applies the answers to its state and
 * the ordinary autosave carries them through the versioned draft (C3) with
 * the attribution on the state — the assistant never gets a write path of
 * its own, so it can never bypass the version check. The unit test on this
 * file asserts the absence of any table write.
 */
const bodySchema = z.object({
  text: z.string().trim().min(12).max(4000),
  /** The screen's current answers, so unmentioned fields are left alone. */
  quick: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Start the estimate first." }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Tell me a little more — a sentence or two about the job." }, { status: 400 });
  const { text } = parsed.data;
  const current: QuickLook = { ...DEFAULT_QUICK_LOOK, ...((parsed.data.quick ?? {}) as Partial<QuickLook>) };

  let extraction: BriefExtraction;
  const svc = createServiceClient();
  if (usingStubModel() || !process.env.ANTHROPIC_API_KEY || !svc) {
    extraction = heuristicExtract(text);
  } else {
    try {
      const settings = await loadAgentSettings(svc);
      const read = await extractBrief(new AnthropicModelClient(), settings.modelHeavy, text);
      extraction = read.ok ? read.extraction : heuristicExtract(text);
    } catch (e) {
      reportError(e, { where: "wizard.describe.extract", bestEffort: true });
      extraction = heuristicExtract(text);
    }
  }

  const injected = extraction.injectedInstructions.length ? extraction.injectedInstructions : detectInjectedInstructions(text);
  const { quick, wrote } = quickLookFromBrief(extraction, current);
  return NextResponse.json({
    quick,
    wrote,
    reply: describeReply(wrote, { unmapped: extraction.unmapped, injected }),
    notes: { unmapped: extraction.unmapped, injected },
  });
}
