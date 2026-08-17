import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_TOOL, PROMPT_VERSION, extractionSchema, type Extraction } from "./schema";
import { sniffKind } from "./normalise";

// SERVER ONLY. Holds the API key.

export const MODEL = "claude-opus-4-5";

/**
 * The instructions. Versioned with the schema (PROMPT_VERSION) and stored on
 * every run, because accuracy has to be comparable across prompt revisions.
 *
 * Most of this exists to stop one failure mode: a model that fills every field
 * because the schema has a slot for it. On a marketing floorplan the honest
 * answer for a bathroom's dimensions is "not printed", and a plausible
 * invention there is far worse than a gap — a gap gets reviewed, an invention
 * gets priced.
 */
const SYSTEM = `You are reading an Australian residential floorplan for a painting estimator.

Report only what is legible. You are not estimating and not measuring.

Rules, in order of importance:

1. NEVER invent a number. If a room's dimensions are not printed on the plan,
   set length_m and width_m to null and dimension_source to "not_dimensioned".
   Bathrooms, ensuites, kitchens, laundries, WCs, entries and hallways are
   routinely labelled without dimensions - that is expected, not a failure.

2. dimension_source is "read" ONLY when the numbers are printed beside the room
   on the plan. Never "read" for anything you worked out yourself.

3. NEVER drop a room. An unlabelled enclosed space is a room with
   name_on_plan: null and normalised_type: "unknown". A human will classify it.

4. Count door and window SYMBOLS on the plan. A door symbol is an arc or a gap
   in a wall; a window is a thin break in the wall line. Count what you see in
   each room. Do not infer from the room type.

5. Report every storey drawn on this page. Marketing plans frequently place
   ground and first floor side by side, or show four levels. Assign each room
   to its storey using the storey's label.

6. If the plan prints "not to scale", or any similar disclaimer, set
   not_to_scale_disclaimer to true. This matters: it tells the estimator that
   nothing can be measured off the drawing.

7. Anything you cannot read - obscured by furniture, cut off, illegible -
   belongs in unreadable_regions with its impact. Do not compensate by guessing.

8. Ignore the site/block plan for room extraction, but set has_site_plan true
   when one is present.

Confidence is per field and should be honest. A dimension string you can read
clearly is 0.9+; one you are inferring from a smudge is 0.3.`;

export type ReadResult =
  | { ok: true; extraction: Extraction; model: string; promptVersion: string; inputTokens: number; outputTokens: number; costCents: number }
  | { ok: false; message: string; code: "no_api_key" | "no_credit" | "rate_limited" | "bad_key" | "overloaded" | "refused" | "invalid_output" | "api_error" };

/**
 * Turn the API's own error into something an estimator can act on.
 *
 * Without this the raw failure reaches the screen as a JSON blob — which is
 * exactly what happened the first time a plan was read against an account with
 * no credit on it. "Your credit balance is too low" buried in a request-id dump
 * tells a painter nothing about what to do.
 */
type FailCode = "no_api_key" | "no_credit" | "rate_limited" | "bad_key" | "overloaded" | "refused" | "invalid_output" | "api_error";

function interpretApiError(raw: string): { code: FailCode; message: string } {
  const t = raw.toLowerCase();
  if (t.includes("credit balance")) {
    return {
      code: "no_credit",
      message: "The Anthropic account has no credit left, so plans can't be read. Top it up under Plans & Billing and try again.",
    };
  }
  if (t.includes("authentication") || t.includes("invalid x-api-key") || t.includes("invalid_api_key")) {
    return { code: "bad_key", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server." };
  }
  if (t.includes("rate limit") || t.includes("rate_limit")) {
    return { code: "rate_limited", message: "Too many plans at once — wait a moment and read this page again." };
  }
  if (t.includes("overloaded")) {
    return { code: "overloaded", message: "The model is busy. Try this page again in a minute." };
  }
  return { code: "api_error", message: `The plan couldn't be read: ${raw.slice(0, 300)}` };
}

/** Opus 4.5 list pricing, in cents per million tokens. */
const COST_IN_PER_MTOK = 500;
const COST_OUT_PER_MTOK = 2500;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * One page in, one validated extraction out.
 *
 * The tool is FORCED, so the model cannot answer in prose, and the result is
 * parsed through the same zod schema the rest of the pipeline relies on — a
 * response that does not fit is an error, not something to paper over.
 */
export async function readFloorplanPage(
  imageBytes: Uint8Array,
  opts: { pageContext?: string } = {},
): Promise<ReadResult> {
  if (!hasApiKey()) {
    return {
      ok: false,
      code: "no_api_key",
      message: "ANTHROPIC_API_KEY is not set — add it to the server environment to read plans.",
    };
  }

  // The media type comes from the BYTES, not from an assumption. Rendered PDF
  // pages are PNG, but a plan uploaded straight off a listing site is usually a
  // JPEG — and declaring the wrong one is rejected outright by the API. Every
  // JPEG plan failed this way on the first live run.
  const kind = sniffKind(imageBytes);
  const mediaType =
    kind === "jpeg" ? "image/jpeg" :
    kind === "png" ? "image/png" :
    kind === "webp" ? "image/webp" : null;
  if (!mediaType) {
    return {
      ok: false,
      code: "api_error",
      message: "That page isn't an image the model can read (JPEG, PNG or WEBP).",
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const base64 = Buffer.from(imageBytes).toString("base64");

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            {
              type: "text",
              text: opts.pageContext
                ? `Read this floorplan page. Context: ${opts.pageContext}`
                : "Read this floorplan page.",
            },
          ],
        },
      ],
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const { code, message } = interpretApiError(raw);
    return { ok: false, code, message };
  }

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { ok: false, code: "refused", message: "The model did not return a structured reading of the plan." };
  }

  const parsed = extractionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_output",
      message: `The reading did not fit the schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  return {
    ok: true,
    extraction: parsed.data,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    inputTokens,
    outputTokens,
    costCents: Math.round(
      (inputTokens / 1_000_000) * COST_IN_PER_MTOK + (outputTokens / 1_000_000) * COST_OUT_PER_MTOK,
    ),
  };
}
