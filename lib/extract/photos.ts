import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { sniffKind } from "./normalise";
import { doorStyles, windowStyles } from "./schema";

// SERVER ONLY.

export const PHOTO_PROMPT_VERSION = "photos-2026-08-18-b";

/** Must match defect_prep_rates.defect_type — the CODE prices these, never the model. */
export const defectTypes = [
  "peeling", "flaking", "water_damage", "plaster_cracks", "render_cracks",
  "holes_dents", "mould", "nicotine_staining", "efflorescence", "rust", "timber_rot",
] as const;

/**
 * What property photos are for: the three things a floorplan physically cannot
 * show, and which decide real money on the rate card.
 *
 *   door style     flat vs 4-6 panel — different rates
 *   window style   four different rates
 *   cornice        present or not — plenty of these houses are square-set
 *
 * Plus ceiling height, which a photo can often place within a band and which
 * multiplies every wall in the job.
 *
 * The instruction throughout is Tom's: WHEN UNSURE, SAY UNSURE. Nothing here is
 * generated on a maybe — an unknown answer means the line is not added and the
 * estimator is asked instead.
 */

export const photoReadSchema = z.object({
  shows: z.enum(["interior_room", "exterior", "detail", "other"]),
  room_guess: z.string().max(60).nullable(),
  doors: z.object({
    visible: z.number().int().min(0).max(20),
    style: z.enum(doorStyles),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().transform((s) => s.slice(0, 200)),
  }),
  windows: z.object({
    visible: z.number().int().min(0).max(20),
    style: z.enum(windowStyles),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().transform((s) => s.slice(0, 200)),
  }),
  cornice: z.object({
    state: z.enum(["present", "absent", "unknown"]),
    profile: z.enum(["standard_cove", "patterned_ornate", "square_set", "unknown"]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().transform((s) => s.slice(0, 200)),
  }),
  ceiling_height: z.object({
    estimate_m: z.number().min(2).max(6).nullable(),
    basis: z.enum(["door_head_reference", "brick_or_board_courses", "proportion_only", "not_visible"]),
    confidence: z.number().min(0).max(1),
  }),
  /** Only defects CLEARLY visible in this photo - an empty list is the normal answer. */
  defects: z.array(z.object({
    type: z.enum(defectTypes),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    qty: z.number().min(0).max(500),
    confidence: z.number().min(0).max(1),
    // A long-winded justification is not a reason to throw the reading away.
    reasoning: z.string().transform((s) => s.slice(0, 200)),
  })).max(8).default([]),
  notes: z.string().transform((s) => s.slice(0, 300)),
});

export type PhotoRead = z.infer<typeof photoReadSchema>;

const PHOTO_TOOL = {
  name: "report_photo",
  description: "Report only what this photograph actually shows. Say 'unknown' whenever you are not sure.",
  input_schema: {
    type: "object" as const,
    properties: {
      shows: { type: "string", enum: ["interior_room", "exterior", "detail", "other"] },
      room_guess: { type: ["string", "null"], description: "Which room this looks like, if it is obvious" },
      doors: {
        type: "object",
        properties: {
          visible: { type: "integer" },
          style: { type: "string", enum: [...doorStyles], description: "flat = smooth face. panel = 4-6 raised panels. IF YOU CANNOT SEE THE DOOR FACE CLEARLY, ANSWER 'unknown'." },
          confidence: { type: "number" },
          reasoning: { type: "string", description: "What in the photo told you" },
        },
        required: ["visible", "style", "confidence", "reasoning"],
      },
      windows: {
        type: "object",
        properties: {
          visible: { type: "integer" },
          style: { type: "string", enum: [...windowStyles], description: "IF YOU CANNOT TELL THE TYPE, ANSWER 'unknown'." },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["visible", "style", "confidence", "reasoning"],
      },
      cornice: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["present", "absent", "unknown"], description: "Is there a cornice at the wall/ceiling junction? A square-set junction means 'absent'. If the junction is not visible, 'unknown'." },
          profile: { type: "string", enum: ["standard_cove", "patterned_ornate", "square_set", "unknown"] },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["state", "profile", "confidence", "reasoning"],
      },
      ceiling_height: {
        type: "object",
        properties: {
          estimate_m: { type: ["number", "null"], description: "Only with a reference you can actually see. An Australian door head is 2.04 m." },
          basis: { type: "string", enum: ["door_head_reference", "brick_or_board_courses", "proportion_only", "not_visible"] },
          confidence: { type: "number" },
        },
        required: ["estimate_m", "basis", "confidence"],
      },
      defects: {
        type: "array",
        maxItems: 8,
        description: "Paint/surface defects CLEARLY visible in this photo. An empty list is the normal answer for a sound surface. Report only what you can point to.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...defectTypes] },
            severity: { type: "integer", enum: [1, 2, 3], description: "1 = light/localised, 2 = moderate, 3 = heavy/widespread" },
            qty: {
              type: "number",
              description: "Approximate affected extent, in the defect's own unit: m2 for peeling/flaking/water damage/mould/nicotine/efflorescence/rust, LINEAL METRES for plaster or render cracks and timber rot, a COUNT for holes/dents. Estimate conservatively from what is visible.",
            },
            confidence: { type: "number" },
            reasoning: { type: "string", description: "What in the photo shows this defect" },
          },
          required: ["type", "severity", "qty", "confidence", "reasoning"],
        },
      },
      notes: { type: "string" },
    },
    required: ["shows", "room_guess", "doors", "windows", "cornice", "ceiling_height", "defects", "notes"],
  },
};

const SYSTEM = `You are looking at a photograph of an Australian house for a painting estimator.

You are answering three questions that a floorplan cannot answer, and each one
changes the price:

1. DOOR STYLE. Flat (smooth face) or 4-6 panel (raised panels). These are
   different rates. If you cannot see a door face clearly enough to be sure,
   answer "unknown" - the estimator would rather add it themselves than have a
   guess priced.

2. WINDOW STYLE. Fixed/picture, awning/casement, double-hung sash, or
   colonial/bay. Same rule: unsure means "unknown".

3. CORNICE. Look at the junction where the wall meets the ceiling. A cornice is
   a moulded strip; a square-set junction is a plain sharp corner. If that
   junction is not visible in the photo, answer "unknown". Never assume a
   cornice - many of these houses are square-set.

Also estimate ceiling height ONLY if you can see a reference: a door head is
2.04 m in Australia, a brick course is 86 mm. Judging by proportion alone is not
good enough - answer null with basis "proportion_only" instead.

4. DEFECTS. Report paint/surface defects you can clearly SEE and point to:
   peeling, flaking, water damage, plaster or render cracks, holes/dents,
   mould, nicotine staining, efflorescence, rust, timber rot. Each defect adds
   preparation hours to the quote, so a defect you invent costs the customer
   real money: an EMPTY LIST is the normal answer for a sound surface. Severity
   1 = light, 2 = moderate, 3 = heavy. Estimate the affected extent
   conservatively from what is visible in frame.

Say what in the photograph led you to each answer. "Unknown" is a perfectly good
answer and is always better than a plausible guess.`;

export type PhotoResult =
  | { ok: true; read: PhotoRead; inputTokens: number; outputTokens: number; costCents: number }
  | { ok: false; message: string };

/**
 * A7: the question the photo was sent to answer. The wizard's damage-photo
 * path used to run through the generic ask ("what about doors, windows,
 * cornices?") whose framing tells the model an empty defect list is the
 * normal answer — so customer damage photos produced no defects and no prep.
 * A "damage" purpose puts the defects question first and says why the photo
 * exists; the same conservative rules (only what is clearly visible) hold.
 */
export type PhotoPurpose = "property" | "damage";

const USER_TURN: Record<PhotoPurpose, string> = {
  property: "What does this photo tell you about doors, windows, cornices and ceiling height?",
  damage: [
    "This photo was submitted by the customer SPECIFICALLY to show damage that",
    "needs repairing before painting — question 4 (defects) is the primary",
    "question. Identify each defect you can clearly see: its type, severity and",
    "conservative visible extent. The same rule holds: only what the photograph",
    "actually shows, but expect this one to show something — the customer took",
    "it to show us a problem. Answer the door/window/cornice questions too if",
    "the photo happens to show them.",
  ].join(" "),
};

export async function readPropertyPhoto(bytes: Uint8Array, purpose: PhotoPurpose = "property"): Promise<PhotoResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "ANTHROPIC_API_KEY is not set." };

  const kind = sniffKind(bytes);
  const mediaType = kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : kind === "webp" ? "image/webp" : null;
  if (!mediaType) return { ok: false, message: "That file isn't a photo the model can read." };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: SYSTEM,
      tools: [PHOTO_TOOL],
      tool_choice: { type: "tool", name: PHOTO_TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: USER_TURN[purpose] },
        ],
      }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { ok: false, message: "The model didn't answer in the expected shape." };

    const parsed = photoReadSchema.safeParse(toolUse.input);
    if (!parsed.success) return { ok: false, message: `Unusable photo reading: ${parsed.error.issues[0]?.message}` };

    return {
      ok: true,
      read: parsed.data,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costCents: Math.round((response.usage.input_tokens / 1e6) * 500 + (response.usage.output_tokens / 1e6) * 2500),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fold what the photos saw into the plan's reading.
 *
 * Only CONFIDENT, AGREED answers are applied. If two photos disagree on the
 * cornice, or the model was unsure, the room keeps "unknown" and the estimator
 * is asked — which is the whole point of the rule.
 */
export function mergePhotoFindings(reads: PhotoRead[], minConfidence = 0.7) {
  const pick = <T extends string>(values: Array<{ v: T; c: number }>, unknown: T): T => {
    const good = values.filter((x) => x.v !== unknown && x.c >= minConfidence);
    if (good.length === 0) return unknown;
    const counts = new Map<T, number>();
    for (const g of good) counts.set(g.v, (counts.get(g.v) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    // A tie means the photos disagree, which is not a confident answer.
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return unknown;
    return ranked[0][0];
  };

  const heights = reads
    .map((r) => r.ceiling_height)
    .filter((h) => h.estimate_m != null && h.basis !== "proportion_only" && h.basis !== "not_visible" && h.confidence >= minConfidence);

  // Defects: keep confident observations, and when two photos show the same
  // defect type in the same room, keep the WORST one rather than summing -
  // two photos of one peeling wall are one problem, not two.
  const defects: Array<{ type: string; severity: 1 | 2 | 3; qty: number; room_hint: string | null; confidence: number; reasoning: string }> = [];
  for (const r of reads) {
    for (const d of r.defects ?? []) {
      if (d.confidence < minConfidence || d.qty <= 0) continue;
      const key = `${d.type}::${(r.room_guess ?? "").toLowerCase()}`;
      const existing = defects.find((x) => `${x.type}::${(x.room_hint ?? "").toLowerCase()}` === key);
      if (existing) {
        if (d.severity > existing.severity || (d.severity === existing.severity && d.qty > existing.qty)) {
          Object.assign(existing, { severity: d.severity, qty: d.qty, confidence: d.confidence, reasoning: d.reasoning });
        }
      } else {
        defects.push({ type: d.type, severity: d.severity, qty: d.qty, room_hint: r.room_guess, confidence: d.confidence, reasoning: d.reasoning });
      }
    }
  }

  return {
    doorStyle: pick(reads.map((r) => ({ v: r.doors.style, c: r.doors.confidence })), "unknown" as const),
    windowStyle: pick(reads.map((r) => ({ v: r.windows.style, c: r.windows.confidence })), "unknown" as const),
    cornice: pick(reads.map((r) => ({ v: r.cornice.state, c: r.cornice.confidence })), "unknown" as const),
    ceilingHeightM: heights.length
      ? Math.round((heights.reduce((n, h) => n + (h.estimate_m ?? 0), 0) / heights.length) * 20) / 20
      : null,
    defects,
    photosRead: reads.length,
  };
}
