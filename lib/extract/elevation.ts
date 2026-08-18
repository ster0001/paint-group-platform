import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { sniffKind } from "./normalise";
import { elevations, heightBases, type ElevationRead } from "./exterior";

// SERVER ONLY.

/**
 * Phase E2: the eyes for the E1 measurement model (lib/extract/exterior.ts).
 *
 * Two readers, one discipline. THE MODEL IDENTIFIES, THE CODE COMPUTES — and
 * for the envelope the rule is harder than the floorplan's: every number
 * needs a NAMEABLE REFERENCE. A height comes from a door head, counted brick
 * or board courses, or a storey line; a width comes from a reference in the
 * photo or a site-plan edge. "It looks about six metres" prices nothing —
 * the segment defers and the job carries requires_site_check, which is the
 * honest outcome for a photo-and-plan estimate (E1 header; the interior-box
 * heuristic this replaces scored -53%..+49% and was rejected).
 *
 * Reference sizes come from the measurement_units Settings table (seeded from
 * brief §5.2) so Tom can correct a course size without a deploy; the
 * FALLBACK_UNITS mirror the seed for databases that haven't run it.
 */

export const ELEVATION_PROMPT_VERSION = "elevation-2026-08-19-b";

export type UnitRow = { unit_key: string; label: string; size_mm: number; tolerance_pct: number };

/** Mirrors scripts/seed-extraction-settings.ts UNITS — used when the table is empty. */
export const FALLBACK_UNITS: UnitRow[] = [
  { unit_key: "brick_course", label: "Brick course (76 mm brick + 10 mm joint)", size_mm: 86, tolerance_pct: 4 },
  { unit_key: "weatherboard_course", label: "Weatherboard course (profile-dependent)", size_mm: 142, tolerance_pct: 10 },
  { unit_key: "door_head", label: "Australian standard door height", size_mm: 2040, tolerance_pct: 8 },
  { unit_key: "storey_default", label: "Assumed storey height", size_mm: 2400, tolerance_pct: 15 },
  { unit_key: "storey_modern", label: "Modern storey height", size_mm: 2550, tolerance_pct: 15 },
];

const confidence = z.number().min(0).max(1);
const reason = z.string().transform((s) => s.slice(0, 200));

/** The stored reading for an elevation run — ElevationRead plus the model's working. */
export const elevationReadSchema = z.object({
  kind: z.literal("elevation_read"),
  elevation: z.enum(elevations),
  cladding: z.array(z.object({
    material: z.enum(["weatherboard", "render", "stucco", "colorbond", "brick", "unknown"]),
    widthM: z.number().positive().max(60).nullable(),
    widthBasis: z.enum(["site_plan_edge", "reference_in_photo", "none"]),
    heightM: z.number().positive().max(12).nullable(),
    heightBasis: z.enum(heightBases),
    confidence,
    reasoning: reason,
  })).max(8),
  trims: z.array(z.object({
    kind: z.enum(["fascia", "gutter", "eaves"]),
    linealM: z.number().positive().max(120).nullable(),
    confidence,
  })).max(6),
  confidence,
  notes: z.string().transform((s) => s.slice(0, 300)),
});

export type StoredElevationRead = z.infer<typeof elevationReadSchema>;

/**
 * The stored reading for a site-plan or footprint run: building edges.
 * Bases, in order of trust (Tom's ruling, 19 Aug 2026):
 *   printed_dimension  a dimension printed for the edge itself
 *   scale_bar          measured against a drawn scale bar
 *   room_sum           RULE 2 — the floorplan's printed room widths summed
 *                      along that side, standard widths for unlisted rooms.
 *                      Always flagged for a human check downstream.
 */
export const sitePlanReadSchema = z.object({
  kind: z.literal("site_plan_read"),
  edges: z.array(z.object({
    side: z.enum(elevations),
    lengthM: z.number().positive().max(100).nullable(),
    basis: z.enum(["printed_dimension", "scale_bar", "room_sum", "none"]),
    confidence,
    reasoning: reason,
  })).max(8),
  perimeterM: z.number().positive().max(400).nullable(),
  storeys: z.number().int().min(1).max(4).nullable(),
  confidence,
  notes: z.string().transform((s) => s.slice(0, 300)),
});

export type SitePlanRead = z.infer<typeof sitePlanReadSchema>;

function unitLines(units: UnitRow[]): string {
  const rows = units.length ? units : FALLBACK_UNITS;
  return rows.map((u) => `  ${u.unit_key.padEnd(20)} ${u.size_mm} mm (±${u.tolerance_pct}%) — ${u.label}`).join("\n");
}

const ELEVATION_TOOL = (units: UnitRow[]) => ({
  name: "report_elevation",
  description: "Report the cladding and trims of this house elevation. Every metre needs a nameable reference — no reference, no number.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["elevation_read"] },
      elevation: {
        type: "string", enum: [...elevations],
        description: "Which side of the house this photo shows. 'front' has the entry door/porch; use 'unknown' when you cannot orient it.",
      },
      cladding: {
        type: "array", maxItems: 8,
        description: "One entry per distinct cladding band on this elevation (e.g. brick base + weatherboard upper = two entries).",
        items: {
          type: "object",
          properties: {
            material: { type: "string", enum: ["weatherboard", "render", "stucco", "colorbond", "brick", "unknown"], description: "IF YOU CANNOT TELL, ANSWER 'unknown' — a guessed material is a wrong rate on the whole wall." },
            widthM: { type: ["number", "null"], description: "Metres across this band, ONLY from a countable reference (bricks are 230 mm long, a single garage door is 2.4 m, a door leaf 0.82 m) or null." },
            widthBasis: { type: "string", enum: ["site_plan_edge", "reference_in_photo", "none"], description: "'none' whenever widthM is null. You cannot use site_plan_edge — that is filled in later from the site plan." },
            heightM: { type: ["number", "null"], description: "The FULL painted height of this band in metres — counted courses, a door-head chain, or a standard storey height per the system prompt. An approximate count is a measurement. Null only when the band's extent is genuinely not visible." },
            heightBasis: { type: "string", enum: [...heightBases], description: "'none' only when heightM is null. Counted courses = brick_course/board_count; door chain = door_head; standard storey = storey_line." },
            confidence: { type: "number" },
            reasoning: { type: "string", description: "The reference you counted, e.g. '14 weatherboard courses above the brick base'." },
          },
          required: ["material", "widthM", "widthBasis", "heightM", "heightBasis", "confidence", "reasoning"],
        },
      },
      trims: {
        type: "array", maxItems: 6,
        description: "Fascia, gutter, eaves runs on THIS elevation, lineal metres, only when the elevation's width is referenced — otherwise null.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fascia", "gutter", "eaves"] },
            linealM: { type: ["number", "null"] },
            confidence: { type: "number" },
          },
          required: ["kind", "linealM", "confidence"],
        },
      },
      confidence: { type: "number", description: "Overall confidence in this elevation reading." },
      notes: { type: "string", description: "Anything the estimator should know: obstructions, two-storey sections, unpainted areas." },
    },
    required: ["kind", "elevation", "cladding", "trims", "confidence", "notes"],
  },
});

const ELEVATION_SYSTEM = (units: UnitRow[]) => `You are looking at a photograph of one side of an Australian house for a painting estimator.

Your job: identify each CLADDING band (weatherboard, render, stucco, colorbond, brick) and measure its painted HEIGHT. Every number you give is flagged for a human check before it is priced, so the estimator's rule is: give your best photo-based measurement with honest confidence, and reserve null for what the photo genuinely does not show.

Height references, best first (sizes from the estimator's own settings):
${unitLines(units)}

1. COUNT when you can: "23 brick courses ≈ 2.0 m", "14 weatherboard courses ≈ 2.0 m". An approximate count is fine — "about 18 courses (±2)" is a measurement, not a guess. Basis "board_count" / "brick_course".
2. CHAIN from a door: a door head is 2.04 m — add the counted or estimated bands above it ("door head 2.04 + ~0.5 m to the eave ≈ 2.5 m"). Basis "door_head". Report the FULL painted height of the band, never just the reference's own height.
3. STANDARD STOREY when nothing is countable but the band clearly runs floor-to-eave: a single storey is ~2.4 m (older) or ~2.55 m (modern); a two-storey facade is two of them plus ~0.3 m floor structure. Basis "storey_line", confidence 0.6–0.7.
Give null with basis "none" only when the band's extent is genuinely not visible (obstructions, severe crop). Gable triangles: report about half the gable's peak rise as the band height and say so in reasoning.

Widths: only from a countable reference IN THE PHOTO — bricks are 230 mm long, a single garage door 2.4 m, a double 4.8 m, a door leaf 0.82 m. Basis "reference_in_photo". Otherwise null: the floorplan's room sums supply widths separately, so a null width here is normal and expected.

Brick that is ALREADY PAINTED still reports material "brick". Unpainted face brick that is staying unpainted is not a cladding band at all — mention it in notes instead.

Trims: fascia, gutters and eaves in lineal metres when the run's extent is visible; otherwise null.

Confidence is your honesty channel: counted 0.75–0.9, chained 0.7–0.8, standard-storey 0.6–0.7. Below 0.6 the segment is measured on site instead.`;

export type ElevationResult =
  | { ok: true; read: StoredElevationRead; inputTokens: number; outputTokens: number; costCents: number }
  | { ok: false; message: string };

const mediaTypeOf = (bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null => {
  const kind = sniffKind(bytes);
  return kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : kind === "webp" ? "image/webp" : null;
};

const cost = (usage: { input_tokens: number; output_tokens: number }) =>
  Math.round((usage.input_tokens / 1e6) * 500 + (usage.output_tokens / 1e6) * 2500);

export async function readElevationPhoto(
  bytes: Uint8Array,
  opts: { units?: UnitRow[] } = {},
): Promise<ElevationResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "ANTHROPIC_API_KEY is not set." };
  const mediaType = mediaTypeOf(bytes);
  if (!mediaType) return { ok: false, message: "That file isn't a photo the model can read." };

  const units = opts.units?.length ? opts.units : FALLBACK_UNITS;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const tool = ELEVATION_TOOL(units);
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 3000,
      system: ELEVATION_SYSTEM(units),
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: "Which elevation is this, what cladding does it carry, and what can you measure from real references?" },
        ],
      }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { ok: false, message: "The model didn't answer in the expected shape." };
    const parsed = elevationReadSchema.safeParse({ kind: "elevation_read", ...(toolUse.input as Record<string, unknown>) });
    if (!parsed.success) return { ok: false, message: `Unusable elevation reading: ${parsed.error.issues[0]?.message}` };

    return { ok: true, read: parsed.data, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, costCents: cost(response.usage) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const SITE_PLAN_TOOL = {
  name: "report_site_plan",
  description: "Report the building footprint's edge lengths from this site plan — printed dimensions or a scale bar only, never estimated.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["site_plan_read"] },
      edges: {
        type: "array", maxItems: 8,
        description: "One entry per building edge you can measure. 'front' faces the street.",
        items: {
          type: "object",
          properties: {
            side: { type: "string", enum: [...elevations] },
            lengthM: { type: ["number", "null"], description: "ONLY from a printed dimension or a scale bar. Null otherwise." },
            basis: { type: "string", enum: ["printed_dimension", "scale_bar", "none"], description: "'none' whenever lengthM is null. Most marketing site insets have neither — null everything is then the correct answer." },
            confidence: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["side", "lengthM", "basis", "confidence", "reasoning"],
        },
      },
      perimeterM: { type: ["number", "null"], description: "Building perimeter, only when enough edges are measured to state it." },
      storeys: { type: ["integer", "null"], description: "Only if the plan states it." },
      confidence: { type: "number" },
      notes: { type: "string", description: "Sheds, garages, decks — anything drawn that is not the house." },
    },
    required: ["kind", "edges", "perimeterM", "storeys", "confidence", "notes"],
  },
};

const SITE_PLAN_SYSTEM = `You are reading a site plan (block plan) of an Australian property for a painting estimator.

Your only job is the BUILDING FOOTPRINT's edge lengths — they become the widths of the exterior walls to be painted. The rule is absolute: a length exists ONLY if it is printed on the plan or measurable against a drawn scale bar. Marketing site insets usually have neither; in that case every lengthM is null with basis "none", which is the correct and expected answer — the site visit measures instead.

Ignore sheds, garages, decks, pergolas and boundary fences except to mention them in notes. "front" is the street-facing side.`;

export type SitePlanResult =
  | { ok: true; read: SitePlanRead; inputTokens: number; outputTokens: number; costCents: number }
  | { ok: false; message: string };

export async function readSitePlan(bytes: Uint8Array): Promise<SitePlanResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "ANTHROPIC_API_KEY is not set." };
  const mediaType = mediaTypeOf(bytes);
  if (!mediaType) return { ok: false, message: "That file isn't an image the model can read." };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: SITE_PLAN_SYSTEM,
      tools: [SITE_PLAN_TOOL],
      tool_choice: { type: "tool", name: SITE_PLAN_TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: "What building footprint edges can you measure from printed dimensions or a scale bar?" },
        ],
      }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { ok: false, message: "The model didn't answer in the expected shape." };
    const parsed = sitePlanReadSchema.safeParse({ kind: "site_plan_read", ...(toolUse.input as Record<string, unknown>) });
    if (!parsed.success) return { ok: false, message: `Unusable site-plan reading: ${parsed.error.issues[0]?.message}` };

    return { ok: true, read: parsed.data, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, costCents: cost(response.usage) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Typical widths for rooms the plan doesn't dimension (rule 2's standard
 * measurements — same numbers as the room_type_defaults Settings table). */
export type TypicalWidthRow = { room_type: string; typical_width_m: number };

const FOOTPRINT_TOOL = {
  name: "report_footprint",
  description: "Derive the building's overall edge lengths from the floorplan's printed room dimensions. State your working per edge.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["site_plan_read"] },
      edges: {
        type: "array", maxItems: 8,
        description: "One entry per external side of the building. 'front' faces the entry/street side of the plan.",
        items: {
          type: "object",
          properties: {
            side: { type: "string", enum: [...elevations] },
            lengthM: { type: ["number", "null"], description: "The side's overall length: a printed overall dimension if one exists, else the SUM of the printed widths of the rooms lying along that side (plus ~0.25 m per internal wall crossed). Standard widths for unlisted rooms are in the system prompt. Null only when the layout along that side cannot be followed at all." },
            basis: { type: "string", enum: ["printed_dimension", "scale_bar", "room_sum", "none"], description: "'printed_dimension' only for an overall dimension printed for the whole side. Summed room widths are 'room_sum'." },
            confidence: { type: "number" },
            reasoning: { type: "string", description: "The rooms you summed, e.g. 'living 4.0 + bed2 3.2 + bath 1.5 (standard) + 2 walls 0.5 = 9.2 m'." },
          },
          required: ["side", "lengthM", "basis", "confidence", "reasoning"],
        },
      },
      perimeterM: { type: ["number", "null"] },
      storeys: { type: ["integer", "null"], description: "How many storeys the plan shows." },
      confidence: { type: "number" },
      notes: { type: "string" },
    },
    required: ["kind", "edges", "perimeterM", "storeys", "confidence", "notes"],
  },
};

const FOOTPRINT_SYSTEM = (typicals: TypicalWidthRow[]) => `You are reading a residential FLOORPLAN for a painting estimator who needs the building's OUTSIDE wall lengths (they become the widths of the exterior walls to be painted).

The plan prints each room's dimensions. For each external side of the building, follow the rooms that sit along that side and SUM their printed dimensions in that direction, adding roughly 0.25 m for each internal wall you cross. If an overall dimension for the whole side is printed, use it directly (basis "printed_dimension"); a summed answer is basis "room_sum".

Rooms the plan labels but does not dimension use these standard widths (metres):
${(typicals.length ? typicals : [{ room_type: "wc", typical_width_m: 1.0 }, { room_type: "laundry", typical_width_m: 1.5 }, { room_type: "bathroom", typical_width_m: 1.5 }]).map((t) => `  ${t.room_type.padEnd(28)} ${t.typical_width_m}`).join("\n")}

Show your working in each edge's reasoning — the estimator checks these sums before they are used. Answer null only when you genuinely cannot follow the layout along a side.`;

export async function readFloorplanFootprint(
  bytes: Uint8Array,
  opts: { typicals?: TypicalWidthRow[] } = {},
): Promise<SitePlanResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "ANTHROPIC_API_KEY is not set." };
  const mediaType = mediaTypeOf(bytes);
  if (!mediaType) return { ok: false, message: "That file isn't an image the model can read." };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2500,
      system: FOOTPRINT_SYSTEM(opts.typicals ?? []),
      tools: [FOOTPRINT_TOOL],
      tool_choice: { type: "tool", name: FOOTPRINT_TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: "What are the building's overall edge lengths, summed from the printed room dimensions?" },
        ],
      }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { ok: false, message: "The model didn't answer in the expected shape." };
    const parsed = sitePlanReadSchema.safeParse({ ...(toolUse.input as Record<string, unknown>), kind: "site_plan_read" });
    if (!parsed.success) return { ok: false, message: `Unusable footprint reading: ${parsed.error.issues[0]?.message}` };

    return { ok: true, read: parsed.data, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, costCents: cost(response.usage) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pure: fill photo-unmeasured widths from site-plan edges. A photo's own
 * referenced width is never overwritten — the closer source wins — and only
 * edges with a real basis and confidence contribute. Left/right edges run
 * front-to-back, so an elevation's width comes from ITS OWN side's edge.
 */
export function mergeSitePlanWidths(
  reads: ElevationRead[],
  sitePlan: SitePlanRead | null,
  minConfidence = 0.6,
): ElevationRead[] {
  if (!sitePlan) return reads;
  const edgeFor = new Map<string, number>();
  for (const e of sitePlan.edges) {
    if (e.lengthM != null && e.basis !== "none" && e.confidence >= minConfidence && !edgeFor.has(e.side)) {
      edgeFor.set(e.side, e.lengthM);
    }
  }
  return reads.map((r) => {
    const width = edgeFor.get(r.elevation);
    if (width == null) return r;
    return {
      ...r,
      cladding: r.cladding.map((seg) =>
        seg.widthM == null || seg.widthBasis === "none"
          ? { ...seg, widthM: width, widthBasis: "site_plan_edge" as const }
          : seg,
      ),
    };
  });
}
